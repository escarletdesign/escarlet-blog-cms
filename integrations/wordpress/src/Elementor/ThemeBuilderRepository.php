<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Elementor;

use Escarlet\ElementorBridge\Auth\Permission;
use Escarlet\ElementorBridge\Revisions\CheckpointRepository;
use Escarlet\ElementorBridge\Schema\CanonicalJson;
use Escarlet\ElementorBridge\Schema\SchemaValidator;
use Escarlet\ElementorBridge\Support\Errors;
use WP_Error;

final class ThemeBuilderRepository
{
    public function __construct(
        private readonly ElementorAdapter $elementor,
        private readonly CheckpointRepository $checkpoints,
        private readonly SchemaValidator $validator,
        private readonly CanonicalJson $canonical,
    ) {
    }

    /** @return array<int, array<string, mixed>> */
    public function listFooters(): array
    {
        return $this->elementor->listThemeTemplates('footer');
    }

    /** @return array<string, mixed>|WP_Error */
    public function getFooter(int $postId): array|WP_Error
    {
        if (! $this->elementor->isProActive()) {
            return Errors::make('ELEMENTOR_PRO_REQUIRED', 'Elementor Pro debe estar activo para leer templates globales.', 424);
        }

        $footer = $this->findFooter($postId);
        if ($footer === null) {
            return Errors::make('THEME_TEMPLATE_NOT_FOUND', 'No se encontró el footer Theme Builder solicitado.', 404, ['templateId' => $postId]);
        }

        $raw = $this->elementor->read($postId);
        if ($raw instanceof WP_Error) {
            return $raw;
        }
        $template = [
            'id' => (string) $postId,
            'type' => 'footer',
            'title' => $footer['title'],
            'status' => $footer['status'],
            'settings' => $raw['settings'],
            'children' => $this->elementor->toSchema($postId, $raw['elements']),
            'extensions' => ['themeBuilder' => ['conditions' => $footer['conditions']]],
        ];
        $schema = ['schemaVersion' => '1.0', 'template' => $template];
        $urls = $this->elementor->urls($postId);
        if ($urls instanceof WP_Error) {
            return $urls;
        }

        return [
            'template' => $schema,
            'documentVersion' => $this->canonical->hash($schema),
            'urls' => $urls,
        ];
    }

    /** @param array<string, mixed> $payload @return array<string, mixed>|WP_Error */
    public function mutateFooter(int $postId, array $payload): array|WP_Error
    {
        if (($payload['confirm'] ?? false) !== true) {
            return Errors::make('CONFIRMATION_REQUIRED', 'Modificar un footer global requiere confirm=true.', 422);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }

        $current = $this->getFooter($postId);
        if ($current instanceof WP_Error) {
            return $current;
        }
        $force = ! empty($payload['force']);
        $expected = (string) ($payload['expectedDocumentVersion'] ?? '');
        if (! $force && $expected !== '' && ! hash_equals((string) $current['documentVersion'], $expected)) {
            return Errors::make('DOCUMENT_VERSION_CONFLICT', 'El footer cambió desde la lectura anterior.', 409, [
                'expectedDocumentVersion' => $expected,
                'actualDocumentVersion' => $current['documentVersion'],
                'diff' => ['requestedOperation' => $payload['operation'] ?? 'update_node', 'templateId' => $postId],
            ]);
        }

        $template = $current['template']['template'];
        $operation = (string) ($payload['operation'] ?? 'update_node');
        $changed = $this->applyOperation($template, $payload, $operation);
        if ($changed instanceof WP_Error) {
            return $changed;
        }
        $valid = $this->validator->validateNodes($changed['children']);
        if ($valid instanceof WP_Error) {
            return $valid;
        }
        $sanitizedNodes = $this->validator->sanitizeNodes($changed['children']);
        if ($sanitizedNodes instanceof WP_Error) {
            return $sanitizedNodes;
        }
        $changed['children'] = $sanitizedNodes;

        $checkpoint = $this->checkpoints->create($postId, $current['template'], [
            'tool' => (string) ($payload['tool'] ?? 'rest.theme_builder.footer.mutate'),
            'reason' => (string) ($payload['reason'] ?? $operation),
            'userId' => get_current_user_id(),
            'previousHash' => $current['documentVersion'],
        ]);
        if ($checkpoint instanceof WP_Error) {
            return $checkpoint;
        }
        if (function_exists('wp_save_post_revision')) {
            wp_save_post_revision($postId);
        }
        $save = $this->elementor->save(
            $postId,
            $this->elementor->toElementor($postId, $changed['children']),
            (array) $changed['settings'],
            (string) $changed['status'],
        );
        if ($save instanceof WP_Error) {
            return $save;
        }

        $updated = $this->getFooter($postId);
        if ($updated instanceof WP_Error) {
            return $updated;
        }
        $updated['checkpointId'] = $checkpoint;
        $updated['changedNodeIds'] = $this->changedNodeIds($current['template']['template']['children'], $updated['template']['template']['children']);
        return $updated;
    }

    /** @param array<string, mixed> $payload @return array<string, mixed>|WP_Error */
    public function createFooter(array $payload): array|WP_Error
    {
        if (($payload['confirm'] ?? false) !== true) {
            return Errors::make('CONFIRMATION_REQUIRED', 'Crear un footer global requiere confirm=true.', 422);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }
        if (! $this->elementor->isProActive()) {
            return Errors::make('ELEMENTOR_PRO_REQUIRED', 'Elementor Pro debe estar activo para crear el footer global.', 424);
        }

        $title = sanitize_text_field((string) ($payload['title'] ?? 'Footer global'));
        if ($title === '' || mb_strlen($title) > 200) {
            return Errors::make('INVALID_REQUEST', 'title es obligatorio y debe tener hasta 200 caracteres.', 422);
        }
        $status = (string) ($payload['status'] ?? 'publish');
        if (! in_array($status, ['draft', 'publish'], true)) {
            return Errors::make('INVALID_REQUEST', 'status debe ser draft o publish.', 422);
        }
        $conditions = $this->normalizeConditions((array) ($payload['conditions'] ?? ['include/general']));
        if ($conditions instanceof WP_Error) {
            return $conditions;
        }

        $nodes = (array) ($payload['children'] ?? []);
        $valid = $this->validator->validateNodes($nodes);
        if ($valid instanceof WP_Error) {
            return $valid;
        }
        $sanitizedNodes = $this->validator->sanitizeNodes($nodes);
        if ($sanitizedNodes instanceof WP_Error) {
            return $sanitizedNodes;
        }
        $existing = array_filter($this->listFooters(), static fn (array $footer): bool => $footer['title'] === $title);
        if ($existing !== []) {
            return Errors::make('TEMPLATE_EXISTS', 'Ya existe un footer Theme Builder con ese título.', 409, [
                'templates' => array_values($existing),
            ]);
        }

        $created = $this->elementor->createThemeTemplate('footer', $title, $status, $sanitizedNodes, [], $conditions);
        if ($created instanceof WP_Error) {
            return $created;
        }
        $snapshot = [
            'schemaVersion' => '1.0',
            'document' => [
                'id' => (string) $created['id'],
                'type' => 'footer',
                'title' => $created['title'],
                'status' => $created['status'],
                'settings' => [],
                'children' => $sanitizedNodes,
                'extensions' => ['themeBuilder' => ['conditions' => $conditions]],
            ],
        ];
        $checkpoint = $this->checkpoints->create((int) $created['id'], $snapshot, [
            'tool' => 'rest.theme_builder.footer.create',
            'reason' => 'Initial global footer creation',
            'userId' => get_current_user_id(),
        ]);
        if ($checkpoint instanceof WP_Error) {
            return $checkpoint;
        }
        $created['checkpointId'] = $checkpoint;
        $created['documentVersion'] = $this->canonical->hash($snapshot);
        return $created;
    }

    /** @param array<string, mixed> $payload @return array<string, mixed>|WP_Error */
    public function syncFooterConditions(int $postId, array $payload): array|WP_Error
    {
        if (($payload['confirm'] ?? false) !== true) {
            return Errors::make('CONFIRMATION_REQUIRED', 'Cambiar las condiciones de un footer global requiere confirm=true.', 422);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }

        $footer = null;
        foreach ($this->listFooters() as $candidate) {
            if ((int) ($candidate['id'] ?? 0) === $postId) {
                $footer = $candidate;
                break;
            }
        }
        if ($footer === null) {
            return Errors::make('THEME_TEMPLATE_NOT_FOUND', 'No se encontró el footer Theme Builder solicitado.', 404, ['templateId' => $postId]);
        }

        $conditions = $this->normalizeConditions((array) ($payload['conditions'] ?? ['include/general']));
        if ($conditions instanceof WP_Error) {
            return $conditions;
        }

        $snapshot = [
            'schemaVersion' => '1.0',
            'document' => [
                'id' => (string) $postId,
                'type' => 'footer',
                'title' => $footer['title'],
                'status' => $footer['status'],
                'settings' => [],
                'children' => [],
                'extensions' => ['themeBuilder' => ['conditions' => $footer['conditions']]],
            ],
        ];
        $checkpoint = $this->checkpoints->create($postId, $snapshot, [
            'tool' => 'rest.theme_builder.footer.conditions',
            'reason' => 'Synchronize global footer display conditions',
            'userId' => get_current_user_id(),
        ]);
        if ($checkpoint instanceof WP_Error) {
            return $checkpoint;
        }

        $saved = $this->elementor->saveThemeTemplateConditions($postId, $conditions);
        if ($saved instanceof WP_Error) {
            return $saved;
        }

        $updated = $footer;
        $updated['conditions'] = array_values($conditions);
        $updated['checkpointId'] = $checkpoint;
        $updated['documentVersion'] = $this->canonical->hash([
            'schemaVersion' => '1.0',
            'document' => [
                'id' => (string) $postId,
                'type' => 'footer',
                'title' => $footer['title'],
                'status' => $footer['status'],
                'settings' => [],
                'children' => [],
                'extensions' => ['themeBuilder' => ['conditions' => $conditions]],
            ],
        ]);
        return $updated;
    }

    /** @param array<int, mixed> $conditions @return array<int, string>|WP_Error */
    private function normalizeConditions(array $conditions): array|WP_Error
    {
        $normalized = array_values(array_filter(array_map(
            static fn (mixed $condition): string => sanitize_text_field((string) $condition),
            $conditions,
        )));
        if ($normalized === []) {
            $normalized = ['include/general'];
        }
        foreach ($normalized as $condition) {
            if (! preg_match('/^(include|exclude)\/[a-z0-9_-]+$/', $condition)) {
                return Errors::make('INVALID_REQUEST', 'conditions contiene una condición Theme Builder no válida.', 422, ['condition' => $condition]);
            }
        }
        return $normalized;
    }

    /** @return array<string, mixed>|null */
    private function findFooter(int $postId): ?array
    {
        foreach ($this->listFooters() as $footer) {
            if ((int) ($footer['id'] ?? 0) === $postId) {
                return $footer;
            }
        }
        return null;
    }

    /** @param array<string, mixed> $document @param array<string, mixed> $payload @return array<string, mixed>|WP_Error */
    private function applyOperation(array $document, array $payload, string $operation): array|WP_Error
    {
        $targetId = (string) ($payload['targetId'] ?? '');
        if ($operation === 'update_node') {
            $patch = $payload['patch'] ?? null;
            if ($targetId === '' || ! is_array($patch)) {
                return Errors::make('INVALID_OPERATION', 'update_node requiere targetId y patch.', 422);
            }
            $found = &$this->findNode($document['children'], $targetId);
            if ($found === null) {
                return Errors::make('NODE_NOT_FOUND', 'No se encontró el nodo solicitado.', 404, ['targetId' => $targetId]);
            }
            foreach ($patch as $path => $value) {
                $sanitizedValue = $this->sanitizePatchValue((string) $path, $value);
                if ($sanitizedValue instanceof WP_Error) {
                    return $sanitizedValue;
                }
                $this->setPath($found, (string) $path, $sanitizedValue);
            }
            return $document;
        }

        if ($operation === 'delete_node') {
            if ($targetId === '') {
                return Errors::make('INVALID_OPERATION', 'delete_node requiere targetId.', 422);
            }
            if ($this->removeNode($document['children'], $targetId) === null) {
                return Errors::make('NODE_NOT_FOUND', 'No se encontró el nodo solicitado.', 404, ['targetId' => $targetId]);
            }
            return $document;
        }

        if ($operation === 'insert_node') {
            $node = $payload['node'] ?? null;
            if (! is_array($node)) {
                return Errors::make('INVALID_OPERATION', 'insert_node requiere node.', 422);
            }
            $valid = $this->validator->validateNodes([$node]);
            if ($valid instanceof WP_Error) {
                return $valid;
            }
            $sanitized = $this->validator->sanitizeNodes([$node]);
            if ($sanitized instanceof WP_Error) {
                return $sanitized;
            }
            $node = $sanitized[0];
            $parentId = (string) ($payload['parentId'] ?? '');
            if ($parentId === '') {
                $document['children'][] = $node;
                return $document;
            }
            $parent = &$this->findNode($document['children'], $parentId);
            if ($parent === null || $parent['type'] !== 'container') {
                return Errors::make('NODE_NOT_FOUND', 'No se encontró el container parentId.', 404, ['parentId' => $parentId]);
            }
            $parent['children'][] = $node;
            return $document;
        }

        return Errors::make('INVALID_OPERATION', 'Operación no soportada.', 422, ['operation' => $operation]);
    }

    /** @param array<int, array<string, mixed>> $nodes */
    private function &findNode(array &$nodes, string $id): ?array
    {
        foreach ($nodes as &$node) {
            if ((string) ($node['id'] ?? '') === $id) {
                return $node;
            }
            if (is_array($node['children'] ?? null)) {
                $found = &$this->findNode($node['children'], $id);
                if ($found !== null) {
                    return $found;
                }
            }
        }
        $null = null;
        return $null;
    }

    /** @param array<int, array<string, mixed>> $nodes */
    private function removeNode(array &$nodes, string $id): ?array
    {
        foreach ($nodes as $index => &$node) {
            if ((string) ($node['id'] ?? '') === $id) {
                $removed = $node;
                array_splice($nodes, $index, 1);
                return $removed;
            }
            if (is_array($node['children'] ?? null)) {
                $removed = $this->removeNode($node['children'], $id);
                if ($removed !== null) {
                    return $removed;
                }
            }
        }
        return null;
    }

    /** @param array<string, mixed> $target */
    private function setPath(array &$target, string $path, mixed $value): void
    {
        $parts = array_values(array_filter(explode('.', $path), static fn (string $part): bool => $part !== ''));
        if ($parts === []) {
            return;
        }
        $cursor = &$target;
        foreach (array_slice($parts, 0, -1) as $part) {
            if (! isset($cursor[$part]) || ! is_array($cursor[$part])) {
                $cursor[$part] = [];
            }
            $cursor = &$cursor[$part];
        }
        $cursor[$parts[array_key_last($parts)]] = $value;
    }

    private function sanitizePatchValue(string $path, mixed $value): mixed
    {
        if (preg_match('/custom[_-]?css|javascript|<script|php[_-]?code/i', $path)) {
            return Errors::make('UNSAFE_SETTING', 'No se permite modificar CSS personalizado, JavaScript o PHP mediante el bridge.', 422, ['path' => $path]);
        }
        if (str_ends_with($path, '.content') || $path === 'content') {
            return wp_kses_post((string) $value);
        }
        if (str_ends_with($path, '.url') || $path === 'url') {
            return esc_url_raw((string) $value);
        }
        if (is_string($value)) {
            return sanitize_text_field($value);
        }
        return $value;
    }

    /** @param array<int, array<string, mixed>> $before @param array<int, array<string, mixed>> $after @return array<int, string> */
    private function changedNodeIds(array $before, array $after): array
    {
        $left = $this->flattenNodes($before);
        $right = $this->flattenNodes($after);
        $ids = array_unique(array_merge(array_keys($left), array_keys($right)));
        return array_values(array_filter($ids, static fn (string $id): bool => ($left[$id] ?? null) !== ($right[$id] ?? null)));
    }

    /** @param array<int, array<string, mixed>> $nodes @return array<string, mixed> */
    private function flattenNodes(array $nodes): array
    {
        $result = [];
        foreach ($nodes as $node) {
            $id = (string) ($node['id'] ?? '');
            $children = $node['children'] ?? [];
            $copy = $node;
            unset($copy['children']);
            $result[$id] = $copy;
            if (is_array($children)) {
                $result += $this->flattenNodes($children);
            }
        }
        return $result;
    }
}
