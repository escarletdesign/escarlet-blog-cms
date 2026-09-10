<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Elementor;

use Escarlet\ElementorBridge\Support\Errors;
use Escarlet\ElementorBridge\Support\Environment;
use WP_Error;

final class ElementorAdapter
{
    private readonly NodeConverter $converter;

    public function __construct()
    {
        $this->converter = new NodeConverter(new NodeIdentity());
    }

    public function isActive(): bool
    {
        return defined('ELEMENTOR_VERSION') && class_exists('Elementor\\Plugin');
    }

    public function version(): ?string
    {
        return defined('ELEMENTOR_VERSION') ? (string) ELEMENTOR_VERSION : null;
    }

    public function isProActive(): bool
    {
        return defined('ELEMENTOR_PRO_VERSION');
    }

    public function requireActive(): bool|WP_Error
    {
        if (! $this->isActive()) {
            return Errors::make('ELEMENTOR_REQUIRED', 'Elementor debe estar instalado y activo para esta operación.', 424);
        }
        return true;
    }

    public function document(int $postId): object|false
    {
        if (! $this->isActive()) {
            return false;
        }
        $documents = \Elementor\Plugin::$instance->documents ?? null;
        return $documents && method_exists($documents, 'get') ? $documents->get($postId) : false;
    }

    public function isBuilt(int $postId): bool
    {
        $document = $this->document($postId);
        if ($document && method_exists($document, 'is_built_with_elementor')) {
            return (bool) $document->is_built_with_elementor();
        }

        return get_post_meta($postId, '_elementor_edit_mode', true) === 'builder';
    }

    /** @return array{elements: array<int, array<string, mixed>>, settings: array<string, mixed>}|WP_Error */
    public function read(int $postId): array|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        $document = $this->document($postId);
        if (! $document) {
            return Errors::make('ELEMENTOR_DOCUMENT_NOT_FOUND', 'No se encontró un documento Elementor para este post.', 404, ['documentId' => $postId]);
        }
        if (! method_exists($document, 'get_elements_data')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'La versión instalada de Elementor no ofrece el lector de elementos esperado.', 501, ['version' => $this->version()]);
        }

        $elements = $document->get_elements_data();
        $settings = method_exists($document, 'get_settings') ? $document->get_settings() : [];
        return [
            'elements' => is_array($elements) ? $elements : [],
            'settings' => is_array($settings) ? $settings : [],
        ];
    }

    /** @param array<int, array<string, mixed>> $nodes @return array<string, mixed>|WP_Error */
    public function createPage(string $title, string $status, array $nodes, array $settings): array|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        $documents = \Elementor\Plugin::$instance->documents ?? null;
        if (! $documents || ! method_exists($documents, 'create')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'La versión instalada de Elementor no ofrece creación de documentos compatible.', 501, ['version' => $this->version()]);
        }

        // The post type is page, but the Elementor document type must also be
        // `page`. Passing `post` here creates a page with `_elementor_template_type`
        // set to `wp-post`, which prevents Theme Builder page conditions from
        // applying the site's global header and footer.
        $document = $documents->create('page', [
            'post_type' => 'page',
            'post_title' => $title,
            'post_status' => $status,
        ]);
        if ($document instanceof WP_Error) {
            return $document;
        }
        if (! is_object($document) || ! method_exists($document, 'save')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'Elementor no devolvió un documento guardable.', 501);
        }
        $post = method_exists($document, 'get_post') ? $document->get_post() : null;
        $postId = $post ? (int) $post->ID : 0;
        if (! $postId) {
            return Errors::make('DOCUMENT_CREATE_FAILED', 'Elementor no devolvió el ID del documento creado.', 500);
        }
        $document->save(['elements' => $this->converter->toElementor($postId, $nodes), 'settings' => $settings]);

        return $this->urls($postId);
    }

    public function save(int $postId, array $elements, array $settings, string $status): bool|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        $document = $this->document($postId);
        if (! $document || ! method_exists($document, 'save')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'El documento Elementor no puede guardarse mediante la API disponible.', 501, ['version' => $this->version()]);
        }
        $document->save(['elements' => $elements, 'settings' => $settings]);
        if (get_post_status($postId) !== $status) {
            $updated = wp_update_post(['ID' => $postId, 'post_status' => $status], true);
            if ($updated instanceof WP_Error) {
                return $updated;
            }
        }

        return true;
    }

    /** @return array<string, mixed> */
    public function toSchema(int $postId, array $raw): array
    {
        return $this->converter->toSchema($postId, $raw);
    }

    /** @return array<int, array<string, mixed>> */
    public function toElementor(int $postId, array $nodes): array
    {
        return $this->converter->toElementor($postId, $nodes);
    }

    public function canWriteWidget(string $widget): bool
    {
        return CapabilityRegistry::canWrite(sanitize_key($widget));
    }

    /** @return array<string, mixed>|WP_Error */
    public function urls(int $postId): array|WP_Error
    {
        $post = get_post($postId);
        if (! $post) {
            return Errors::make('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
        }
        $document = $this->document($postId);
        return [
            'id' => $postId,
            'previewUrl' => get_permalink($postId),
            'editUrl' => admin_url('post.php?post=' . $postId . '&action=elementor'),
            'elementorVersion' => $this->version(),
            'documentType' => $document && method_exists($document, 'get_name') ? $document->get_name() : 'post',
        ];
    }

    /**
     * Create a Theme Builder template through Elementor's Document Manager.
     *
     * The document type and conditions stay inside this adapter so the REST
     * layer never has to write Elementor's private post meta directly.
     *
     * @param array<int, array<string, mixed>> $nodes
     * @param array<string, mixed> $settings
     * @param array<int, string> $conditions
     * @return array<string, mixed>|WP_Error
     */
    public function createThemeTemplate(string $type, string $title, string $status, array $nodes, array $settings, array $conditions): array|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        if (! $this->isProActive()) {
            return Errors::make('ELEMENTOR_PRO_REQUIRED', 'Elementor Pro debe estar activo para crear templates globales.', 424);
        }
        if (! in_array($type, ['footer'], true)) {
            return Errors::make('UNSUPPORTED_THEME_TEMPLATE', 'El MVP solo permite crear templates footer.', 422);
        }

        $documents = \Elementor\Plugin::$instance->documents ?? null;
        if (! $documents || ! method_exists($documents, 'create')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'Elementor no ofrece creación de templates compatible.', 501, ['version' => $this->version()]);
        }

        $document = $documents->create($type, [
            'post_type' => 'elementor_library',
            'post_title' => sanitize_text_field($title),
            'post_status' => $status,
        ]);
        if ($document instanceof WP_Error) {
            return $document;
        }
        if (! is_object($document) || ! method_exists($document, 'save')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'Elementor no devolvió un template guardable.', 501);
        }

        $post = method_exists($document, 'get_post') ? $document->get_post() : null;
        $postId = $post ? (int) $post->ID : 0;
        if (! $postId) {
            return Errors::make('DOCUMENT_CREATE_FAILED', 'Elementor no devolvió el ID del template creado.', 500);
        }

        $document->save([
            'elements' => $this->converter->toElementor($postId, $nodes),
            'settings' => $settings,
        ]);
        $conditionResult = $this->saveThemeTemplateConditions($postId, $conditions);
        if ($conditionResult instanceof WP_Error) {
            return $conditionResult;
        }

        return [
            'id' => $postId,
            'title' => get_the_title($postId),
            'status' => get_post_status($postId),
            'type' => (string) get_post_meta($postId, '_elementor_template_type', true),
            'conditions' => array_values((array) get_post_meta($postId, '_elementor_conditions', true)),
            'editUrl' => admin_url('post.php?post=' . $postId . '&action=elementor'),
            'previewUrl' => get_permalink($postId),
            'documentType' => $document && method_exists($document, 'get_name') ? $document->get_name() : $type,
        ];
    }

    /**
     * Save display conditions through Elementor Pro so its conditions cache is rebuilt.
     *
     * Writing _elementor_conditions alone makes the metadata look correct while the
     * frontend can continue using the previous elementor_pro_theme_builder_conditions
     * cache. The manager call is kept behind this adapter because it is an internal,
     * version-checked Elementor Pro API.
     *
     * @param array<int, string> $conditions
     */
    public function saveThemeTemplateConditions(int $postId, array $conditions): bool|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        if (! $this->isProActive()) {
            return Errors::make('ELEMENTOR_PRO_REQUIRED', 'Elementor Pro debe estar activo para guardar condiciones Theme Builder.', 424);
        }

        $moduleClass = 'ElementorPro\\Modules\\ThemeBuilder\\Module';
        if (! class_exists($moduleClass) || ! method_exists($moduleClass, 'instance')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'No se encontró el módulo Theme Builder de Elementor Pro.', 501, ['version' => $this->version()]);
        }

        try {
            $module = $moduleClass::instance();
            $manager = is_object($module) && method_exists($module, 'get_conditions_manager')
                ? $module->get_conditions_manager()
                : null;
            if (! is_object($manager) || ! method_exists($manager, 'save_conditions')) {
                return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'La versión instalada de Elementor Pro no ofrece el gestor de condiciones esperado.', 501, ['version' => $this->version()]);
            }

            $result = $manager->save_conditions($postId, $this->toElementorConditions($conditions));
        } catch (\Throwable $exception) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'No se pudieron guardar las condiciones Theme Builder mediante Elementor Pro.', 501, [
                'version' => $this->version(),
                'exception' => defined('WP_DEBUG') && WP_DEBUG ? $exception->getMessage() : 'redacted',
            ]);
        }

        if ($result instanceof WP_Error) {
            return $result;
        }

        // The manager is authoritative; keep the post meta synchronized for reads and
        // for older Pro versions that do not update it as part of save_conditions().
        update_post_meta($postId, '_elementor_conditions', array_values($conditions));
        return true;
    }

    /**
     * Elementor Pro's internal Conditions Manager expects each condition as a
     * pair such as ['include', 'general']; the REST-neutral representation is
     * the stable string 'include/general'.
     *
     * @param array<int, string> $conditions
     * @return array<int, array<int, string>>
     */
    private function toElementorConditions(array $conditions): array
    {
        return array_values(array_map(static function (string $condition): array {
            [$scope, $location] = array_pad(explode('/', $condition, 2), 2, '');
            return [$scope, $location];
        }, $conditions));
    }

    /** @return array<int, array<string, mixed>> */
    public function listThemeTemplates(string $type = 'footer'): array
    {
        $templates = get_posts([
            'post_type' => 'elementor_library',
            'post_status' => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => 100,
            'orderby' => 'modified',
            'order' => 'DESC',
            'meta_key' => '_elementor_template_type',
            'meta_value' => $type,
        ]);

        return array_map(static function (\WP_Post $post): array {
            return [
                'id' => (int) $post->ID,
                'title' => $post->post_title,
                'status' => $post->post_status,
                'type' => (string) get_post_meta($post->ID, '_elementor_template_type', true),
                'conditions' => array_values((array) get_post_meta($post->ID, '_elementor_conditions', true)),
                'editUrl' => admin_url('post.php?post=' . $post->ID . '&action=elementor'),
                'previewUrl' => get_permalink($post->ID),
            ];
        }, $templates);
    }

    /** @return array<string, mixed>|WP_Error */
    public function regenerateCss(): array|WP_Error
    {
        $required = $this->requireActive();
        if ($required instanceof WP_Error) {
            return $required;
        }
        $plugin = \Elementor\Plugin::$instance;
        $filesManager = $plugin->files_manager ?? null;
        if (! $filesManager || ! method_exists($filesManager, 'clear_cache')) {
            return Errors::make('ELEMENTOR_API_UNAVAILABLE', 'No se encontró la API de regeneración CSS compatible.', 501, ['version' => $this->version()]);
        }
        $filesManager->clear_cache();
        return ['cleared' => true, 'method' => 'files_manager.clear_cache', 'version' => $this->version()];
    }

    /** @return array<string, mixed> */
    public function capabilities(bool $refresh = false): array
    {
        $discovery = CapabilityRegistry::snapshot($refresh);
        $nativePassThroughWidgets = [];
        foreach ((array) ($discovery['widgets'] ?? []) as $widgetName => $widget) {
            if (is_array($widget) && ($widget['status'] ?? '') === 'native-pass-through') {
                $nativePassThroughWidgets[] = (string) $widgetName;
            }
        }
        return [
            'active' => $this->isActive(),
            'version' => $this->version(),
            'proActive' => $this->isProActive(),
            'supportedWidgets' => CapabilityRegistry::verifiedWidgets(),
            'nativePassThroughWidgets' => $nativePassThroughWidgets,
            'blockedWidgets' => CapabilityRegistry::blockedWidgets(),
            'registeredWidgets' => $discovery['registeredWidgets'] ?? [],
            'widgetCapabilities' => $discovery['widgets'] ?? [],
            'discovery' => $discovery,
            'internalApis' => [
                'documentManager' => $this->isActive(),
                'documentSave' => $this->isActive(),
                'cssFilesManager' => $this->isActive(),
            ],
            'environment' => Environment::snapshot(),
        ];
    }
}
