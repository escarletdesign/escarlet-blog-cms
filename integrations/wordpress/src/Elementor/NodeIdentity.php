<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Elementor;

final class NodeIdentity
{
    private const META_KEY = '_escarlet_node_map';
    private const PATH_META_KEY = '_escarlet_node_paths';

    /** @return array<string, string> */
    public function map(int $postId): array
    {
        $map = get_post_meta($postId, self::META_KEY, true);
        return is_array($map) ? array_map('strval', $map) : [];
    }

    public function resolveInternal(int $postId, string $externalId, string $path = ''): string
    {
        $map = $this->map($postId);
        if (isset($map[$externalId])) {
            return $map[$externalId];
        }

        if ($path !== '') {
            $pathMap = $this->paths($postId);
            $pathExternalId = $pathMap[$path] ?? '';
            if ($pathExternalId !== '' && isset($map[$pathExternalId])) {
                return $map[$pathExternalId];
            }
        }

        return $externalId;
    }

    public function externalFor(int $postId, string $internalId, string $path = ''): string
    {
        foreach ($this->map($postId) as $external => $internal) {
            if ($internal === $internalId) {
                return $external;
            }
        }

        if ($path !== '') {
            $pathExternalId = $this->paths($postId)[$path] ?? '';
            if ($pathExternalId !== '') {
                return $pathExternalId;
            }

            return 'legacy-' . substr(hash('sha256', $postId . '|' . $path), 0, 16);
        }

        return $internalId;
    }

    public function remember(int $postId, string $externalId, string $internalId, string $path = ''): void
    {
        $map = $this->map($postId);
        $map[$externalId] = $internalId;
        update_post_meta($postId, self::META_KEY, $map);

        if ($path !== '') {
            $paths = $this->paths($postId);
            $paths[$path] = $externalId;
            update_post_meta($postId, self::PATH_META_KEY, $paths);
        }
    }

    /** @return array<string, string> */
    private function paths(int $postId): array
    {
        $paths = get_post_meta($postId, self::PATH_META_KEY, true);
        return is_array($paths) ? array_map('strval', $paths) : [];
    }

    public function newInternalId(): string
    {
        return substr(hash('sha256', wp_generate_uuid4()), 0, 7);
    }
}
