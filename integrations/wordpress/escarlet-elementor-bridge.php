<?php
/**
 * Plugin Name: Escarlet Elementor Bridge
 * Plugin URI: https://github.com/escarlet/elementor-bridge
 * Description: Secure REST and MCP bridge for editable Elementor documents.
 * Version: 0.2.0
 * Requires at least: 6.8
 * Requires PHP: 8.1
 * Author: Escarlet
 * License: GPL-2.0-or-later
 * Text Domain: escarlet-elementor-bridge
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

define('ESCARLET_EB_VERSION', '0.2.0');
define('ESCARLET_EB_FILE', __FILE__);
define('ESCARLET_EB_DIR', plugin_dir_path(__FILE__));
define('ESCARLET_EB_URL', plugin_dir_url(__FILE__));

spl_autoload_register(static function (string $class): void {
    $prefix = 'Escarlet\\ElementorBridge\\';
    if (! str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $file = ESCARLET_EB_DIR . 'src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_readable($file)) {
        require_once $file;
    }
});

register_activation_hook(__FILE__, ['Escarlet\\ElementorBridge\\Installer', 'activate']);
register_deactivation_hook(__FILE__, ['Escarlet\\ElementorBridge\\Installer', 'deactivate']);

add_action('plugins_loaded', static function (): void {
    \Escarlet\ElementorBridge\Plugin::boot();
}, 20);
