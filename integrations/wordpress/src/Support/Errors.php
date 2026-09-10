<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Support;

use WP_Error;

final class Errors
{
    public static function make(string $code, string $message, int $status = 400, array $details = []): WP_Error
    {
        return new WP_Error($code, $message, [
            'status' => $status,
            'bridge_code' => $code,
            'details' => $details,
        ]);
    }

    public static function code(WP_Error $error): string
    {
        $data = $error->get_error_data();
        return is_array($data) && isset($data['bridge_code']) ? (string) $data['bridge_code'] : (string) $error->get_error_code();
    }

    public static function status(WP_Error $error): int
    {
        $data = $error->get_error_data();
        return is_array($data) && isset($data['status']) ? (int) $data['status'] : 400;
    }

    /** @return array<string, mixed> */
    public static function details(WP_Error $error): array
    {
        $data = $error->get_error_data();
        return is_array($data) && isset($data['details']) && is_array($data['details']) ? $data['details'] : [];
    }
}

