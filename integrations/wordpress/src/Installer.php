<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge;

final class Installer
{
    public static function activate(): void
    {
        if (! get_option('escarlet_eb_settings')) {
            add_option('escarlet_eb_settings', [
                'external_writes_enabled' => false,
                'checkpoint_retention' => 25,
                'read_rate_limit' => 60,
                'write_rate_limit' => 20,
            ], '', false);
        }

        Revisions\CheckpointRepository::register_post_type();
        flush_rewrite_rules(false);
    }

    public static function deactivate(): void
    {
        flush_rewrite_rules(false);
    }
}

