<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Support;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class Response
{
    /** @param array<int, string> $warnings */
    public static function success(mixed $data, WP_REST_Request $request, string $version = '', array $warnings = [], int $status = 200): WP_REST_Response
    {
        $requestId = self::requestId($request);
        $response = new WP_REST_Response([
            'success' => true,
            'data' => $data,
            'meta' => [
                'requestId' => $requestId,
                'documentVersion' => $version,
                'warnings' => array_values($warnings),
            ],
            'error' => null,
        ], $status);
        $response->header('X-Escarlet-Request-ID', $requestId);
        return $response;
    }

    public static function error(WP_Error $error, WP_REST_Request $request): WP_REST_Response
    {
        $requestId = self::requestId($request);
        $response = new WP_REST_Response([
            'success' => false,
            'data' => null,
            'meta' => [
                'requestId' => $requestId,
                'documentVersion' => '',
                'warnings' => [],
            ],
            'error' => [
                'code' => Errors::code($error),
                'message' => $error->get_error_message(),
                'details' => Errors::details($error),
            ],
        ], Errors::status($error));
        $response->header('X-Escarlet-Request-ID', $requestId);
        return $response;
    }

    public static function requestId(WP_REST_Request $request): string
    {
        $existing = (string) $request->get_header('X-Escarlet-Request-ID');
        return $existing !== '' ? sanitize_key($existing) : wp_generate_uuid4();
    }
}

