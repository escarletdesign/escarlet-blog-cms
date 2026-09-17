<?php
/**
 * Plugin Name: Escarlet Blog Client
 * Description: Sincroniza el blog público desde el CMS Escarlet y abre el panel editorial con un PAT personal desde wp-admin. Sin packs HTML estáticos.
 * Version: 1.1.0
 * Author: Escarlet
 * License: GPL-2.0-or-later
 * Text Domain: escarlet-blog-client
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ESCARLET_BLOG_CLIENT_VERSION', '1.1.0' );
define( 'ESCARLET_BLOG_CLIENT_PATH', plugin_dir_path( __FILE__ ) );
define( 'ESCARLET_BLOG_CLIENT_URL', plugin_dir_url( __FILE__ ) );

require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-settings.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-sync.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-webhook.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-permalinks.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-lock-edits.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-admin.php';
require_once ESCARLET_BLOG_CLIENT_PATH . 'includes/class-seo.php';

/**
 * Bootstrap.
 */
function escarlet_blog_client_init(): void {
	Escarlet_Blog_Client_Settings::register();
	Escarlet_Blog_Client_Webhook::register();
	Escarlet_Blog_Client_Permalinks::register();
	Escarlet_Blog_Client_Lock_Edits::register();
	Escarlet_Blog_Client_Admin::register();
	Escarlet_Blog_Client_Seo::register();
}
add_action( 'init', 'escarlet_blog_client_init' );

/**
 * Activation. Generate webhook secret and flush rewrites.
 */
function escarlet_blog_client_activate(): void {
	if ( ! get_option( Escarlet_Blog_Client_Settings::OPTION_WEBHOOK_SECRET ) ) {
		update_option(
			Escarlet_Blog_Client_Settings::OPTION_WEBHOOK_SECRET,
			wp_generate_password( 48, false, false )
		);
	}
	Escarlet_Blog_Client_Permalinks::register_rewrites();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'escarlet_blog_client_activate' );

/**
 * Deactivation.
 */
function escarlet_blog_client_deactivate(): void {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'escarlet_blog_client_deactivate' );
