<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\WordPress;

use Escarlet\ElementorBridge\Auth\Permission;
use Escarlet\ElementorBridge\Elementor\ElementorAdapter;
use Escarlet\ElementorBridge\Revisions\CheckpointRepository;
use Escarlet\ElementorBridge\Schema\CanonicalJson;
use Escarlet\ElementorBridge\Schema\SchemaValidator;
use Escarlet\ElementorBridge\Support\Errors;
use WP_Error;

final class DocumentRepository
{
    public function __construct(
        private readonly ElementorAdapter $elementor,
        private readonly CheckpointRepository $checkpoints,
        private readonly SchemaValidator $validator,
        private readonly CanonicalJson $canonical,
    ) {
    }

    /** @return array<int, array<string, mixed>> */
    public function list(): array
    {
        $posts = get_posts([
            'post_type' => 'page',
            'post_status' => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => 100,
            'orderby' => 'modified',
            'order' => 'DESC',
        ]);
        $documents = [];
        foreach ($posts as $post) {
            if (! current_user_can('edit_post', $post->ID) || ! $this->elementor->isBuilt((int) $post->ID)) {
                continue;
            }
            $documents[] = [
                'id' => (int) $post->ID,
                'type' => 'page',
                'title' => $post->post_title,
                'status' => $post->post_status,
                'modified' => get_post_modified_time(DATE_ATOM, true, $post),
                'previewUrl' => get_permalink($post->ID),
            ];
        }
        return $documents;
    }

    /** @return array{document: array<string, mixed>, documentVersion: string, urls: array<string, mixed>}|WP_Error */
    public function get(int $postId): array|WP_Error
    {
        $permission = Permission::document($postId);
        if ($permission instanceof WP_Error) {
            return $permission;
        }
        $post = get_post($postId);
        if (! $post || $post->post_type !== 'page') {
            return Errors::make('DOCUMENT_NOT_FOUND', 'La página solicitada no existe.', 404, ['documentId' => $postId]);
        }
        $raw = $this->elementor->read($postId);
        if ($raw instanceof WP_Error) {
            return $raw;
        }
        $document = [
            'id' => (string) $postId,
            'type' => 'page',
            'title' => $post->post_title,
            'status' => $post->post_status,
            'settings' => $raw['settings'],
            'children' => $this->elementor->toSchema($postId, $raw['elements']),
            'extensions' => ['wordpress' => ['slug' => $post->post_name]],
        ];
        $schema = ['schemaVersion' => '1.0', 'document' => $document];
        $urls = $this->elementor->urls($postId);
        if ($urls instanceof WP_Error) {
            return $urls;
        }
        return [
            'document' => $schema,
            'documentVersion' => $this->canonical->hash($schema),
            'urls' => $urls,
        ];
    }

    /** @param array<string, mixed> $schema @return array<string, mixed>|WP_Error */
    public function create(array $schema): array|WP_Error
    {
        $valid = $this->validator->validate($schema);
        if ($valid instanceof WP_Error) {
            return $valid;
        }
        $document = $schema['document'];
        $status = (string) $document['status'];
        if (! current_user_can('edit_pages')) {
            return Errors::make('REST_FORBIDDEN', 'Se requiere edit_pages para crear páginas.', 403);
        }
        if ($status === 'publish' && ! current_user_can('publish_pages')) {
            return Errors::make('REST_FORBIDDEN', 'Se requiere publish_pages para publicar páginas.', 403);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }

        $sanitizedDocument = $this->sanitizeIncomingDocument($document);
        if ($sanitizedDocument instanceof WP_Error) {
            return $sanitizedDocument;
        }

        $created = $this->elementor->createPage(
            (string) $sanitizedDocument['title'],
            $status,
            $sanitizedDocument['children'],
            $sanitizedDocument['settings'],
        );
        if ($created instanceof WP_Error) {
            return $created;
        }
        $postId = (int) ($created['id'] ?? 0);
        if (! $postId) {
            return Errors::make('DOCUMENT_CREATE_FAILED', 'No se pudo determinar el ID de la página creada.', 500);
        }
        // The initial document has already been saved by Elementor; create a logical audit record now.
        $current = $this->get($postId);
        if ($current instanceof WP_Error) {
            return $current;
        }
        $this->checkpoints->create($postId, $current['document'], [
            'tool' => 'rest.documents.create',
            'reason' => 'Initial document creation',
            'userId' => get_current_user_id(),
        ]);
        return $current;
    }

    /** @param array<string, mixed> $payload @return array<string, mixed>|WP_Error */
    public function mutate(int $postId, array $payload): array|WP_Error
    {
        $current = $this->get($postId);
        if ($current instanceof WP_Error) {
            return $current;
        }
        $force = ! empty($payload['force']);
        $expected = (string) ($payload['expectedDocumentVersion'] ?? '');
        if (! $force && $expected !== '' && ! hash_equals($current['documentVersion'], $expected)) {
            return Errors::make('DOCUMENT_VERSION_CONFLICT', 'El documento cambió desde la lectura anterior.', 409, [
                'expectedDocumentVersion' => $expected,
                'actualDocumentVersion' => $current['documentVersion'],
                'diff' => $this->summaryDiff($current['document']['document'], $payload),
            ]);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }
        $document = $current['document']['document'];
        $operation = (string) ($payload['operation'] ?? 'update_node');
        $operationResult = $this->applyOperation($document, $payload, $operation);
        if ($operationResult instanceof WP_Error) {
            return $operationResult;
        }
        $candidate = ['schemaVersion' => '1.0', 'document' => $operationResult];
        $valid = $this->validator->validate($candidate);
        if ($valid instanceof WP_Error) {
            return $valid;
        }
        $checkpoint = $this->checkpoints->create($postId, $current['document'], [
            'tool' => (string) ($payload['tool'] ?? 'rest.documents.mutate'),
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
            $this->elementor->toElementor($postId, $operationResult['children']),
            $this->sanitizeSettings((array) $operationResult['settings']),
            (string) $operationResult['status'],
        );
        if ($save instanceof WP_Error) {
            return $save;
        }
        $updated = $this->get($postId);
        if ($updated instanceof WP_Error) {
            return $updated;
        }
        $updated['changedNodeIds'] = $this->changedNodeIds($current['document']['document'], $updated['document']['document']);
        $updated['checkpointId'] = $checkpoint;
        return $updated;
    }

    /** @return array<string, mixed>|WP_Error */
    public function restore(int $postId, int $checkpointId): array|WP_Error
    {
        $current = $this->get($postId);
        if ($current instanceof WP_Error) {
            return $current;
        }
        $checkpoint = $this->checkpoints->get($checkpointId);
        if ($checkpoint instanceof WP_Error || (int) ($checkpoint['documentId'] ?? 0) !== $postId) {
            return Errors::make('CHECKPOINT_NOT_FOUND', 'El checkpoint no pertenece al documento solicitado.', 404);
        }
        $write = Permission::writesEnabled();
        if ($write instanceof WP_Error) {
            return $write;
        }
        $target = $checkpoint['snapshot'];
        $valid = $this->validator->validate($target);
        if ($valid instanceof WP_Error) {
            return $valid;
        }
        $before = $this->checkpoints->create($postId, $current['document'], [
            'tool' => 'rest.documents.restore',
            'reason' => 'Checkpoint restore',
            'userId' => get_current_user_id(),
            'restoredCheckpointId' => $checkpointId,
        ]);
        if ($before instanceof WP_Error) {
            return $before;
        }
        if (function_exists('wp_save_post_revision')) {
            wp_save_post_revision($postId);
        }
        $save = $this->elementor->save(
            $postId,
            $this->elementor->toElementor($postId, $target['document']['children']),
            $this->sanitizeSettings((array) $target['document']['settings']),
            (string) $target['document']['status'],
        );
        if ($save instanceof WP_Error) {
            return $save;
        }
        return $this->get($postId);
    }

    /** @return array<int, array<string, mixed>> */
    public function revisions(int $postId): array
    {
        return [
            'checkpoints' => $this->checkpoints->list($postId),
            'wordpress' => $this->checkpoints->nativeRevisions($postId),
        ];
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
        if (in_array($operation, ['delete_node', 'duplicate_node'], true)) {
            if ($targetId === '') {
                return Errors::make('INVALID_OPERATION', "{$operation} requiere targetId.", 422);
            }
            $removed = $this->removeNode($document['children'], $targetId);
            if ($removed === null) {
                return Errors::make('NODE_NOT_FOUND', 'No se encontró el nodo solicitado.', 404, ['targetId' => $targetId]);
            }
            if ($operation === 'duplicate_node') {
                $removed['id'] = $this->uniqueNodeId($document['children'], (string) $removed['id'] . '-copy');
                $document['children'][] = $removed;
            }
            return $document;
        }
        if ($operation === 'insert_node') {
            $node = $payload['node'] ?? null;
            if (! is_array($node)) {
                return Errors::make('INVALID_OPERATION', 'insert_node requiere node.', 422);
            }
            $sanitizedNode = $this->sanitizeIncomingNode($node, 'node');
            if ($sanitizedNode instanceof WP_Error) {
                return $sanitizedNode;
            }
            $node = $sanitizedNode;
            $parentId = (string) ($payload['parentId'] ?? '');
            if ($parentId === '') {
                $document['children'][] = $node;
                return $document;
            }
            $parent = &$this->findNode($document['children'], $parentId);
            if ($parent === null || $parent['type'] !== 'container') {
                return Errors::make('NODE_NOT_FOUND', 'No se encontró el container parentId.', 404, ['parentId' => $parentId]);
            }
            $children = is_array($parent['children'] ?? null) ? $parent['children'] : [];
            $position = (string) ($payload['position'] ?? 'end');
            if ($position === 'before' || $position === 'after') {
                $siblingId = (string) ($payload['siblingId'] ?? '');
                $index = $this->nodeIndex($children, $siblingId);
                if ($index < 0) {
                    return Errors::make('NODE_NOT_FOUND', 'No se encontró siblingId.', 404, ['siblingId' => $siblingId]);
                }
                array_splice($children, $position === 'before' ? $index : $index + 1, 0, [$node]);
            } else {
                $children[] = $node;
            }
            $parent['children'] = $children;
            return $document;
        }

        return Errors::make('INVALID_OPERATION', 'Operación no soportada.', 422, ['operation' => $operation]);
    }

    /** @param array<int, array<string, mixed>> $nodes @return array<string, mixed>|null */
    private function &findNode(array &$nodes, string $id): ?array
    {
        foreach ($nodes as &$node) {
            if ((string) ($node['id'] ?? '') === $id) {
                return $node;
            }
            if (isset($node['children']) && is_array($node['children'])) {
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
            if (isset($node['children']) && is_array($node['children'])) {
                $removed = $this->removeNode($node['children'], $id);
                if ($removed !== null) {
                    return $removed;
                }
            }
        }
        return null;
    }

    /** @param array<int, array<string, mixed>> $nodes */
    private function nodeIndex(array $nodes, string $id): int
    {
        foreach ($nodes as $index => $node) {
            if ((string) ($node['id'] ?? '') === $id) {
                return $index;
            }
        }
        return -1;
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

    /** @param array<string, mixed> $document @return array<string, mixed>|WP_Error */
    private function sanitizeIncomingDocument(array $document): array|WP_Error
    {
        $settings = $this->sanitizeIncomingSettings((array) ($document['settings'] ?? []), 'document.settings');
        if ($settings instanceof WP_Error) {
            return $settings;
        }
        $children = [];
        foreach ((array) ($document['children'] ?? []) as $index => $node) {
            $sanitized = $this->sanitizeIncomingNode((array) $node, "document.children.{$index}");
            if ($sanitized instanceof WP_Error) {
                return $sanitized;
            }
            $children[] = $sanitized;
        }
        $document['title'] = sanitize_text_field((string) ($document['title'] ?? ''));
        $document['settings'] = $settings;
        $document['children'] = $children;
        return $document;
    }

    /** @param array<string, mixed> $node @return array<string, mixed>|WP_Error */
    private function sanitizeIncomingNode(array $node, string $path): array|WP_Error
    {
        $settings = $this->sanitizeIncomingSettings((array) ($node['settings'] ?? []), "{$path}.settings");
        if ($settings instanceof WP_Error) {
            return $settings;
        }
        $node['id'] = sanitize_key((string) ($node['id'] ?? ''));
        $node['settings'] = $settings;
        $children = [];
        foreach ((array) ($node['children'] ?? []) as $index => $child) {
            $sanitized = $this->sanitizeIncomingNode((array) $child, "{$path}.children.{$index}");
            if ($sanitized instanceof WP_Error) {
                return $sanitized;
            }
            $children[] = $sanitized;
        }
        $node['children'] = $children;
        if (isset($node['semanticRole'])) {
            $node['semanticRole'] = sanitize_html_class((string) $node['semanticRole']);
        }
        return $node;
    }

    /** @param array<string, mixed> $settings @return array<string, mixed>|WP_Error */
    private function sanitizeIncomingSettings(array $settings, string $path): array|WP_Error
    {
        foreach ($settings as $key => $value) {
            $keyString = (string) $key;
            if (preg_match('/custom[_-]?css|javascript|<script|php[_-]?code/i', $keyString)) {
                return Errors::make('UNSAFE_SETTING', 'No se permite guardar CSS personalizado, JavaScript o PHP mediante el bridge.', 422, ['path' => "{$path}.{$keyString}"]);
            }
            if (is_array($value)) {
                $nested = $this->sanitizeIncomingSettings($value, "{$path}.{$keyString}");
                if ($nested instanceof WP_Error) {
                    return $nested;
                }
                $settings[$key] = $nested;
            } elseif (is_string($value)) {
                $settings[$key] = preg_match('/content|editor/i', $keyString) ? wp_kses_post($value) : sanitize_text_field($value);
            }
        }
        return $settings;
    }

    /** @param array<string, mixed> $settings @return array<string, mixed> */
    private function sanitizeSettings(array $settings): array
    {
        foreach ($settings as $key => $value) {
            if (is_string($value) && (str_contains((string) $key, 'html') || $key === 'editor' || $key === 'content')) {
                $settings[$key] = wp_kses_post($value);
            } elseif (is_string($value)) {
                $settings[$key] = sanitize_text_field($value);
            }
        }
        return $settings;
    }

    /** @param array<string, mixed> $document */
    private function uniqueNodeId(array $nodes, string $candidate): string
    {
        $ids = array_map(static fn (array $node): string => (string) ($node['id'] ?? ''), $nodes);
        return in_array($candidate, $ids, true) ? $candidate . '-' . wp_rand(100, 999) : $candidate;
    }

    /** @param array<string, mixed> $before @param array<string, mixed> $after @return array<int, string> */
    private function changedNodeIds(array $before, array $after): array
    {
        $left = $this->flattenNodes($before['children']);
        $right = $this->flattenNodes($after['children']);
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

    /** @param array<string, mixed> $document @param array<string, mixed> $payload @return array<string, mixed> */
    private function summaryDiff(array $document, array $payload): array
    {
        return [
            'requestedOperation' => $payload['operation'] ?? 'update_node',
            'requestedTargetId' => $payload['targetId'] ?? null,
            'currentTitle' => $document['title'] ?? null,
        ];
    }
}
