<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Api;

use Escarlet\ElementorBridge\Auth\Permission;
use Escarlet\ElementorBridge\Elementor\ElementorAdapter;
use Escarlet\ElementorBridge\Elementor\ThemeBuilderRepository;
use Escarlet\ElementorBridge\Revisions\CheckpointRepository;
use Escarlet\ElementorBridge\Support\AuditLog;
use Escarlet\ElementorBridge\Support\Environment;
use Escarlet\ElementorBridge\Support\Errors;
use Escarlet\ElementorBridge\Support\RateLimiter;
use Escarlet\ElementorBridge\Support\Response;
use Escarlet\ElementorBridge\WordPress\DocumentRepository;
use Throwable;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class RestController
{
    private const NAMESPACE = 'escarlet-elementor/v1';

    public function __construct(
        private readonly DocumentRepository $documents,
        private readonly ElementorAdapter $elementor,
        private readonly ThemeBuilderRepository $themeBuilder,
        private readonly CheckpointRepository $checkpoints,
        private readonly RateLimiter $rateLimiter = new RateLimiter(),
        private readonly AuditLog $audit = new AuditLog(),
    ) {
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
        add_filter('rest_post_dispatch', [$this, 'normalizeErrors'], 10, 3);
    }

    public function registerRoutes(): void
    {
        register_rest_route(self::NAMESPACE, '/health', [
            'methods' => 'GET', 'callback' => [$this, 'health'], 'permission_callback' => [Permission::class, 'read'],
        ]);
        register_rest_route(self::NAMESPACE, '/capabilities', [
            'methods' => 'GET', 'callback' => [$this, 'capabilities'], 'permission_callback' => [Permission::class, 'read'],
        ]);
        register_rest_route(self::NAMESPACE, '/documents', [
            ['methods' => 'GET', 'callback' => [$this, 'listDocuments'], 'permission_callback' => [Permission::class, 'read']],
            ['methods' => 'POST', 'callback' => [$this, 'createDocument'], 'permission_callback' => [Permission::class, 'editPages']],
        ]);
        register_rest_route(self::NAMESPACE, '/documents/(?P<id>\d+)', [
            ['methods' => 'GET', 'callback' => [$this, 'getDocument'], 'permission_callback' => [Permission::class, 'read']],
            ['methods' => 'PATCH', 'callback' => [$this, 'mutateDocument'], 'permission_callback' => [Permission::class, 'editPages']],
        ]);
        register_rest_route(self::NAMESPACE, '/documents/(?P<id>\d+)/checkpoint', [
            'methods' => 'POST', 'callback' => [$this, 'createCheckpoint'], 'permission_callback' => [Permission::class, 'editPages'],
        ]);
        register_rest_route(self::NAMESPACE, '/documents/(?P<id>\d+)/restore', [
            'methods' => 'POST', 'callback' => [$this, 'restoreCheckpoint'], 'permission_callback' => [Permission::class, 'editPages'],
        ]);
        register_rest_route(self::NAMESPACE, '/documents/(?P<id>\d+)/revisions', [
            'methods' => 'GET', 'callback' => [$this, 'listRevisions'], 'permission_callback' => [Permission::class, 'read'],
        ]);
        register_rest_route(self::NAMESPACE, '/elementor/regenerate-css', [
            'methods' => 'POST', 'callback' => [$this, 'regenerateCss'], 'permission_callback' => [Permission::class, 'editThemeOptions'],
        ]);
        register_rest_route(self::NAMESPACE, '/theme-builder/templates', [
            ['methods' => 'GET', 'callback' => [$this, 'listThemeBuilderTemplates'], 'permission_callback' => [Permission::class, 'read']],
            ['methods' => 'POST', 'callback' => [$this, 'createThemeBuilderTemplate'], 'permission_callback' => [Permission::class, 'editThemeOptions']],
        ]);
        register_rest_route(self::NAMESPACE, '/theme-builder/templates/(?P<id>\d+)/conditions', [
            'methods' => 'POST', 'callback' => [$this, 'syncThemeBuilderConditions'], 'permission_callback' => [Permission::class, 'editThemeOptions'],
        ]);
        register_rest_route(self::NAMESPACE, '/theme-builder/templates/(?P<id>\d+)', [
            ['methods' => 'GET', 'callback' => [$this, 'getThemeBuilderTemplate'], 'permission_callback' => [Permission::class, 'read']],
            ['methods' => 'PATCH', 'callback' => [$this, 'mutateThemeBuilderTemplate'], 'permission_callback' => [Permission::class, 'editThemeOptions']],
        ]);
    }

    public function normalizeErrors(WP_REST_Response|WP_Error $response, mixed $server, WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        if ($response instanceof WP_Error && str_starts_with($request->get_route(), '/' . self::NAMESPACE . '/')) {
            return Response::error($response, $request);
        }
        return $response;
    }

    public function health(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, fn (): WP_REST_Response => Response::success([
            'status' => 'ok',
            'pluginVersion' => ESCARLET_EB_VERSION,
            'apiVersion' => 'v1',
            'environment' => Environment::snapshot(),
        ], $request));
    }

    public function capabilities(WP_REST_Request $request): WP_REST_Response
    {
        $refresh = in_array((string) $request->get_param('refresh'), ['1', 'true', 'yes'], true);
        return $this->run($request, false, fn (): WP_REST_Response => Response::success([
            'pluginVersion' => ESCARLET_EB_VERSION,
            'restNamespace' => self::NAMESPACE,
            'elementor' => $this->elementor->capabilities($refresh),
            'operations' => [
                'readDocuments' => true,
                'writeDocuments' => Environment::writesEnabled(),
                'themeBuilder' => $this->elementor->isProActive(),
                'themeBuilderTemplates' => [
                    'read' => $this->elementor->isProActive(),
                    'write' => $this->elementor->isProActive() && Environment::writesEnabled(),
                ],
            ],
        ], $request));
    }

    public function listDocuments(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, fn (): WP_REST_Response => Response::success($this->documents->list(), $request));
    }

    public function getDocument(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, function () use ($request): WP_REST_Response|WP_Error {
            $result = $this->documents->get((int) $request['id']);
            if ($result instanceof WP_Error) {
                return $result;
            }
            return Response::success($result['document'], $request, $result['documentVersion'], [], 200);
        });
    }

    public function createDocument(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $body = is_array($body) ? $body : [];
            $schema = isset($body['document']) && isset($body['schemaVersion']) ? $body : ($body['document'] ?? $body);
            $result = $this->documents->create(is_array($schema) ? $schema : []);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('documents.create', (int) ($result['urls']['id'] ?? 0));
            return Response::success($result['document'], $request, $result['documentVersion'], [], 201);
        });
    }

    public function mutateDocument(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $payload = is_array($body) ? $body : [];
            $payload['tool'] = $payload['tool'] ?? 'rest.documents.patch';
            $result = $this->documents->mutate((int) $request['id'], $payload);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('documents.mutate', (int) $request['id'], [
                'operation' => $payload['operation'] ?? 'update_node',
                'targetId' => $payload['targetId'] ?? null,
                'checkpointId' => $result['checkpointId'] ?? null,
            ]);
            return Response::success($result['document'], $request, $result['documentVersion'], [
                'changedNodeIds' => $result['changedNodeIds'] ?? [],
            ]);
        });
    }

    public function createCheckpoint(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $write = Permission::writesEnabled();
            if ($write instanceof WP_Error) {
                return $write;
            }
            $postId = (int) $request['id'];
            $current = $this->documents->get($postId);
            if ($current instanceof WP_Error) {
                return $current;
            }
            $body = $request->get_json_params();
            $context = is_array($body) ? $body : [];
            $checkpoint = $this->checkpoints->create($postId, $current['document'], [
                'tool' => $context['tool'] ?? 'rest.documents.checkpoint',
                'reason' => $context['reason'] ?? 'Explicit checkpoint',
                'userId' => get_current_user_id(),
            ]);
            if ($checkpoint instanceof WP_Error) {
                return $checkpoint;
            }
            $this->audit->record('documents.checkpoint', $postId, ['checkpointId' => $checkpoint]);
            return Response::success(['id' => $checkpoint, 'documentVersion' => $current['documentVersion']], $request, $current['documentVersion'], [], 201);
        });
    }

    public function restoreCheckpoint(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $checkpointId = is_array($body) ? absint($body['checkpointId'] ?? 0) : 0;
            if (! $checkpointId) {
                return Errors::make('INVALID_REQUEST', 'checkpointId es obligatorio.', 422);
            }
            $postId = (int) $request['id'];
            $result = $this->documents->restore($postId, $checkpointId);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('documents.restore', $postId, ['checkpointId' => $checkpointId]);
            return Response::success($result['document'], $request, $result['documentVersion']);
        });
    }

    public function listRevisions(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, function () use ($request): WP_REST_Response|WP_Error {
            $permission = Permission::document((int) $request['id']);
            if ($permission instanceof WP_Error) {
                return $permission;
            }
            return Response::success($this->documents->revisions((int) $request['id']), $request);
        });
    }

    public function regenerateCss(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $write = Permission::writesEnabled();
            if ($write instanceof WP_Error) {
                return $write;
            }
            $result = $this->elementor->regenerateCss();
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('elementor.regenerate_css');
            return Response::success($result, $request);
        });
    }

    public function listThemeBuilderTemplates(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, fn (): WP_REST_Response => Response::success([
            'footers' => $this->themeBuilder->listFooters(),
        ], $request));
    }

    public function createThemeBuilderTemplate(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $payload = is_array($body) ? $body : [];
            $result = $this->themeBuilder->createFooter($payload);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('theme_builder.footer.create', (int) ($result['id'] ?? 0), [
                'checkpointId' => $result['checkpointId'] ?? null,
                'conditions' => $result['conditions'] ?? [],
            ]);
            return Response::success($result, $request, (string) ($result['documentVersion'] ?? ''), [], 201);
        });
    }

    public function syncThemeBuilderConditions(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $payload = is_array($body) ? $body : [];
            $result = $this->themeBuilder->syncFooterConditions((int) $request['id'], $payload);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('theme_builder.footer.conditions', (int) $request['id'], [
                'checkpointId' => $result['checkpointId'] ?? null,
                'conditions' => $result['conditions'] ?? [],
            ]);
            return Response::success($result, $request, (string) ($result['documentVersion'] ?? ''));
        });
    }

    public function getThemeBuilderTemplate(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, false, function () use ($request): WP_REST_Response|WP_Error {
            $result = $this->themeBuilder->getFooter((int) $request['id']);
            if ($result instanceof WP_Error) {
                return $result;
            }
            return Response::success($result, $request, (string) ($result['documentVersion'] ?? ''));
        });
    }

    public function mutateThemeBuilderTemplate(WP_REST_Request $request): WP_REST_Response
    {
        return $this->run($request, true, function () use ($request): WP_REST_Response|WP_Error {
            $body = $request->get_json_params();
            $payload = is_array($body) ? $body : [];
            $result = $this->themeBuilder->mutateFooter((int) $request['id'], $payload);
            if ($result instanceof WP_Error) {
                return $result;
            }
            $this->audit->record('theme_builder.footer.mutate', (int) $request['id'], [
                'checkpointId' => $result['checkpointId'] ?? null,
                'changedNodeIds' => $result['changedNodeIds'] ?? [],
                'operation' => $payload['operation'] ?? 'update_node',
            ]);
            return Response::success($result, $request, (string) ($result['documentVersion'] ?? ''));
        });
    }

    private function run(WP_REST_Request $request, bool $write, callable $callback): WP_REST_Response
    {
        $limited = $this->rateLimiter->check($write);
        if ($limited instanceof WP_Error) {
            return Response::error($limited, $request);
        }
        try {
            $result = $callback();
            if ($result instanceof WP_Error) {
                return Response::error($result, $request);
            }
            return $result;
        } catch (Throwable $exception) {
            return Response::error(Errors::make('INTERNAL_ERROR', 'La operación no pudo completarse.', 500, [
                'exception' => defined('WP_DEBUG') && WP_DEBUG ? $exception->getMessage() : 'redacted',
            ]), $request);
        }
    }
}
