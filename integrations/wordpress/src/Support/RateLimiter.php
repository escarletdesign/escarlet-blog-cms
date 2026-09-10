<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Support;

use WP_Error;

final class RateLimiter
{
    public function check(bool $write = false): bool|WP_Error
    {
        $settings = (array) get_option('escarlet_eb_settings', []);
        $limit = max(1, (int) ($settings[$write ? 'write_rate_limit' : 'read_rate_limit'] ?? ($write ? 20 : 60)));
        $identity = get_current_user_id() . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . ($write ? 'w' : 'r');
        $key = 'escarlet_eb_rl_' . md5($identity);
        $count = (int) get_transient($key);
        if ($count >= $limit) {
            return Errors::make('RATE_LIMITED', 'Se alcanzó el límite temporal de solicitudes.', 429, ['retryAfterSeconds' => 60]);
        }
        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
        return true;
    }
}

