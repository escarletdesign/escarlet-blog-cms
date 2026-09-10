<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Auth;

use Escarlet\ElementorBridge\Support\Errors;

final class Permission
{
    public static function read(): bool
    {
        return is_user_logged_in() && current_user_can('read');
    }

    public static function editPages(): bool
    {
        return is_user_logged_in() && current_user_can('edit_pages');
    }

    public static function manageOptions(): bool
    {
        return is_user_logged_in() && current_user_can('manage_options');
    }

    public static function editThemeOptions(): bool
    {
        return is_user_logged_in() && current_user_can('edit_theme_options');
    }

    public static function document(int $postId, string $action = 'read'): bool|\WP_Error
    {
        $capability = $action === 'publish' ? 'publish_pages' : ($action === 'upload' ? 'upload_files' : 'edit_post');
        $allowed = $capability === 'edit_post' ? current_user_can('edit_post', $postId) : current_user_can($capability);
        if (! $allowed) {
            return Errors::make('REST_FORBIDDEN', 'El usuario autenticado no tiene permisos para este documento.', 403, [
                'capability' => $capability,
                'documentId' => $postId,
            ]);
        }
        return true;
    }

    public static function writesEnabled(): bool|\WP_Error
    {
        if (! \Escarlet\ElementorBridge\Support\Environment::writesEnabled()) {
            return Errors::make('EXTERNAL_WRITES_DISABLED', 'Las escrituras externas están desactivadas en el panel del plugin.', 403);
        }
        return true;
    }
}
