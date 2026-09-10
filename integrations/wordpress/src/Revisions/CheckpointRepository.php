<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Revisions;

use Escarlet\ElementorBridge\Schema\CanonicalJson;

final class CheckpointRepository
{
    private const POST_TYPE = 'escarlet_checkpoint';

    public static function register_post_type(): void
    {
        if (post_type_exists(self::POST_TYPE)) {
            return;
        }
        register_post_type(self::POST_TYPE, [
            'label' => 'Escarlet Checkpoints',
            'public' => false,
            'show_ui' => false,
            'show_in_rest' => false,
            'supports' => [],
            'capability_type' => 'post',
            'map_meta_cap' => true,
        ]);
    }

    /** @param array<string, mixed> $snapshot @param array<string, mixed> $context */
    public function create(int $documentId, array $snapshot, array $context): int|\WP_Error
    {
        self::register_post_type();
        $postId = wp_insert_post([
            'post_type' => self::POST_TYPE,
            'post_status' => 'private',
            'post_title' => sprintf('Checkpoint %d — %s', $documentId, current_time('mysql')),
            'post_author' => get_current_user_id(),
        ], true);
        if ($postId instanceof \WP_Error) {
            return $postId;
        }
        update_post_meta($postId, '_escarlet_document_id', $documentId);
        update_post_meta($postId, '_escarlet_snapshot', $snapshot);
        update_post_meta($postId, '_escarlet_context', $context);
        update_post_meta($postId, '_escarlet_snapshot_hash', (new CanonicalJson())->hash($snapshot));
        $this->enforceRetention($documentId);
        return (int) $postId;
    }

    /** @return array<string, mixed>|\WP_Error */
    public function get(int $checkpointId): array|\WP_Error
    {
        $post = get_post($checkpointId);
        if (! $post || $post->post_type !== self::POST_TYPE) {
            return new \WP_Error('checkpoint_not_found', 'Checkpoint no encontrado.', ['status' => 404]);
        }
        return [
            'id' => (int) $post->ID,
            'documentId' => (int) get_post_meta($post->ID, '_escarlet_document_id', true),
            'snapshot' => (array) get_post_meta($post->ID, '_escarlet_snapshot', true),
            'context' => (array) get_post_meta($post->ID, '_escarlet_context', true),
            'hash' => (string) get_post_meta($post->ID, '_escarlet_snapshot_hash', true),
            'createdAt' => get_post_time(DATE_ATOM, true, $post),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public function list(int $documentId): array
    {
        $posts = get_posts([
            'post_type' => self::POST_TYPE,
            'post_status' => 'private',
            'posts_per_page' => 100,
            'orderby' => 'date',
            'order' => 'DESC',
            'meta_key' => '_escarlet_document_id',
            'meta_value' => $documentId,
        ]);
        return array_map(function (\WP_Post $post): array {
            return [
                'id' => (int) $post->ID,
                'documentId' => (int) get_post_meta($post->ID, '_escarlet_document_id', true),
                'hash' => (string) get_post_meta($post->ID, '_escarlet_snapshot_hash', true),
                'context' => (array) get_post_meta($post->ID, '_escarlet_context', true),
                'createdAt' => get_post_time(DATE_ATOM, true, $post),
            ];
        }, $posts);
    }

    /** @return array<int, array<string, mixed>> */
    public function nativeRevisions(int $documentId): array
    {
        if (! function_exists('wp_get_post_revisions')) {
            return [];
        }
        return array_map(static function (\WP_Post $revision): array {
            return [
                'id' => (int) $revision->ID,
                'parentId' => (int) $revision->post_parent,
                'authorId' => (int) $revision->post_author,
                'createdAt' => get_post_time(DATE_ATOM, true, $revision),
                'title' => $revision->post_title,
            ];
        }, wp_get_post_revisions($documentId, ['posts_per_page' => 100]));
    }

    private function enforceRetention(int $documentId): void
    {
        $settings = (array) get_option('escarlet_eb_settings', []);
        $retention = max(1, min(500, (int) ($settings['checkpoint_retention'] ?? 25)));
        $ids = get_posts([
            'post_type' => self::POST_TYPE,
            'post_status' => 'private',
            'posts_per_page' => -1,
            'orderby' => 'date',
            'order' => 'DESC',
            'fields' => 'ids',
            'meta_key' => '_escarlet_document_id',
            'meta_value' => $documentId,
        ]);
        foreach (array_slice(array_map('intval', $ids), $retention) as $oldId) {
            wp_delete_post($oldId, true);
        }
    }
}

