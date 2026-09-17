<?php
/**
 * Plugin settings (CMS URL, handle, personal user token, webhook secret).
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Settings helpers.
 */
final class Escarlet_Blog_Client_Settings {

	public const OPTION_CMS_URL         = 'escarlet_blog_cms_url';
	public const OPTION_SITE_HANDLE     = 'escarlet_blog_site_handle';
	public const OPTION_USER_TOKEN      = 'escarlet_blog_user_token';
	/** @deprecated Kept only to migrate old installations. */
	public const OPTION_SITE_TOKEN      = 'escarlet_blog_site_token';
	public const OPTION_WEBHOOK_SECRET  = 'escarlet_blog_webhook_secret';
	public const OPTION_LAST_SYNC       = 'escarlet_blog_last_sync';
	public const OPTION_LAST_SYNC_ERROR = 'escarlet_blog_last_sync_error';

	/**
	 * Register option sanitization.
	 */
	public static function register(): void {
		register_setting(
			'escarlet_blog_client',
			self::OPTION_CMS_URL,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( __CLASS__, 'sanitize_url' ),
				'default'           => 'https://blog-cms.escarlet.cc',
			)
		);
		register_setting(
			'escarlet_blog_client',
			self::OPTION_SITE_HANDLE,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( __CLASS__, 'sanitize_handle' ),
				'default'           => '',
			)
		);
		register_setting(
			'escarlet_blog_client',
			self::OPTION_USER_TOKEN,
			array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
				'default'           => '',
			)
		);
	}

	/**
	 * @param mixed $value Raw.
	 * @return string
	 */
	public static function sanitize_url( $value ): string {
		$url = esc_url_raw( (string) $value );
		return untrailingslashit( $url );
	}

	/**
	 * @param mixed $value Raw.
	 * @return string
	 */
	public static function sanitize_handle( $value ): string {
		$handle = strtolower( sanitize_title( (string) $value ) );
		return preg_replace( '/[^a-z0-9\-]/', '', $handle ) ?: '';
	}

	public static function cms_url(): string {
		$url = (string) get_option( self::OPTION_CMS_URL, 'https://blog-cms.escarlet.cc' );
		return untrailingslashit( $url ?: 'https://blog-cms.escarlet.cc' );
	}

	public static function site_handle(): string {
		return (string) get_option( self::OPTION_SITE_HANDLE, '' );
	}

	public static function user_token(): string {
		return (string) get_option( self::OPTION_USER_TOKEN, '' );
	}

	public static function site_token(): string {
		return self::user_token();
	}

	public static function webhook_secret(): string {
		$secret = (string) get_option( self::OPTION_WEBHOOK_SECRET, '' );
		if ( $secret ) {
			return $secret;
		}
		$secret = wp_generate_password( 48, false, false );
		update_option( self::OPTION_WEBHOOK_SECRET, $secret );
		return $secret;
	}

	public static function webhook_url(): string {
		return rest_url( 'escarlet-blog/v1/sync' );
	}

	/**
	 * Whether settings look complete enough to sync / open CMS.
	 */
	public static function is_configured(): bool {
		return self::cms_url() && self::site_handle();
	}

	public static function can_open_cms(): bool {
		return self::is_configured() && self::user_token();
	}
}
