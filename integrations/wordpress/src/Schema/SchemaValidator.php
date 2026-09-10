<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Schema;

use Escarlet\ElementorBridge\Support\Errors;
use WP_Error;

final class SchemaValidator
{
    private const WIDGETS = ['heading', 'text-editor', 'button', 'image', 'nav-menu', 'image-carousel', 'accordion'];
    private const STATUSES = ['draft', 'publish', 'pending', 'private'];

    /** @param callable(string): bool|null $widgetSupport */
    public function __construct(private readonly mixed $widgetSupport = null)
    {
    }

    public function validate(mixed $value): bool|WP_Error
    {
        if (! is_array($value)) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'El documento debe ser un objeto JSON.', 422);
        }
        if (($value['schemaVersion'] ?? null) !== '1.0') {
            return Errors::make('UNSUPPORTED_SCHEMA_VERSION', 'Solo se admite schemaVersion 1.0 en el MVP.', 422);
        }
        if (! isset($value['document']) || ! is_array($value['document'])) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'Falta el objeto document.', 422);
        }

        $document = $value['document'];
        foreach (['id', 'type', 'title', 'status', 'settings', 'children'] as $required) {
            if (! array_key_exists($required, $document)) {
                return Errors::make('INVALID_DOCUMENT_SCHEMA', "Falta el campo document.{$required}.", 422);
            }
        }
        if (! is_string($document['id']) || $document['id'] === '') {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'document.id debe ser un string no vacío.', 422);
        }
        if ($document['type'] !== 'page') {
            return Errors::make('UNSUPPORTED_DOCUMENT_TYPE', 'El MVP solo admite documentos page.', 422);
        }
        if (! is_string($document['title']) || mb_strlen($document['title']) > 200) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'document.title debe ser un string de hasta 200 caracteres.', 422);
        }
        if (! in_array($document['status'], self::STATUSES, true)) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'document.status no es válido.', 422);
        }
        if (! is_array($document['settings']) || ! is_array($document['children'])) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', 'document.settings y document.children deben ser objetos/listas.', 422);
        }

        foreach ($document['children'] as $index => $node) {
            $result = $this->validateNode($node, "document.children.{$index}");
            if ($result instanceof WP_Error) {
                return $result;
            }
        }

        return true;
    }

    /** @param array<int, mixed> $nodes */
    public function validateNodes(array $nodes): bool|WP_Error
    {
        foreach ($nodes as $index => $node) {
            $result = $this->validateNode($node, "nodes.{$index}");
            if ($result instanceof WP_Error) {
                return $result;
            }
        }

        return true;
    }

    /** @param array<int, mixed> $nodes @return array<int, array<string, mixed>>|WP_Error */
    public function sanitizeNodes(array $nodes): array|WP_Error
    {
        $sanitized = [];
        foreach ($nodes as $index => $node) {
            $result = $this->sanitizeNode($node, "nodes.{$index}");
            if ($result instanceof WP_Error) {
                return $result;
            }
            $sanitized[] = $result;
        }

        return $sanitized;
    }

    private function validateNode(mixed $node, string $path): bool|WP_Error
    {
        if (! is_array($node)) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path} debe ser un objeto.", 422);
        }
        foreach (['id', 'type', 'settings', 'children'] as $required) {
            if (! array_key_exists($required, $node)) {
                return Errors::make('INVALID_DOCUMENT_SCHEMA', "Falta {$path}.{$required}.", 422);
            }
        }
        if (! is_string($node['id']) || $node['id'] === '') {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path}.id debe ser un string no vacío.", 422);
        }
        if (! in_array($node['type'], ['container', 'widget'], true)) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path}.type no es válido.", 422);
        }
        if (! is_array($node['settings']) || ! is_array($node['children'])) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path}.settings y {$path}.children deben ser objetos/listas.", 422);
        }
        if ($node['type'] === 'widget') {
            $widget = isset($node['widget']) ? sanitize_key((string) $node['widget']) : '';
            $known = in_array($widget, self::WIDGETS, true);
            $dynamic = is_callable($this->widgetSupport) && $widget !== '' && (bool) ($this->widgetSupport)($widget);
            if ($widget === '' || (! $known && ! $dynamic)) {
                return Errors::make('UNSUPPORTED_WIDGET', "{$path}.widget no está soportado por el MVP.", 422, ['supported' => self::WIDGETS]);
            }
            if ($node['children'] !== []) {
                return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path} widget no puede contener children.", 422);
            }
        }
        foreach ($node['children'] as $index => $child) {
            $result = $this->validateNode($child, "{$path}.children.{$index}");
            if ($result instanceof WP_Error) {
                return $result;
            }
        }

        return true;
    }

    /** @return array<string, mixed>|WP_Error */
    private function sanitizeNode(mixed $node, string $path): array|WP_Error
    {
        if (! is_array($node)) {
            return Errors::make('INVALID_DOCUMENT_SCHEMA', "{$path} debe ser un objeto.", 422);
        }
        $settings = $this->sanitizeSettings((array) ($node['settings'] ?? []), "{$path}.settings");
        if ($settings instanceof WP_Error) {
            return $settings;
        }
        $children = [];
        foreach ((array) ($node['children'] ?? []) as $index => $child) {
            $result = $this->sanitizeNode($child, "{$path}.children.{$index}");
            if ($result instanceof WP_Error) {
                return $result;
            }
            $children[] = $result;
        }
        $node['id'] = sanitize_key((string) ($node['id'] ?? ''));
        $node['settings'] = $settings;
        $node['children'] = $children;
        if (isset($node['semanticRole'])) {
            $node['semanticRole'] = sanitize_html_class((string) $node['semanticRole']);
        }
        return $node;
    }

    /** @return array<string, mixed>|WP_Error */
    private function sanitizeSettings(array $settings, string $path): array|WP_Error
    {
        foreach ($settings as $key => $value) {
            $keyString = (string) $key;
            if (preg_match('/custom[_-]?css|javascript|<script|php[_-]?code/i', $keyString)) {
                return Errors::make('UNSAFE_SETTING', 'No se permite guardar CSS personalizado, JavaScript o PHP mediante el bridge.', 422, ['path' => "{$path}.{$keyString}"]);
            }
            if (is_array($value)) {
                $nested = $this->sanitizeSettings($value, "{$path}.{$keyString}");
                if ($nested instanceof WP_Error) {
                    return $nested;
                }
                $settings[$key] = $nested;
            } elseif (is_string($value)) {
                $settings[$key] = preg_match('/content|editor/i', $keyString)
                    ? wp_kses_post($value)
                    : sanitize_text_field($value);
            }
        }
        return $settings;
    }
}
