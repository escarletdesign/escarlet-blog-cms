<?php
/**
 * REST webhook for CMS notifyRebuild → sync.
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Webhook REST routes.
 */
final class Escarlet_Blog_Client_Webhook {

	/**
	 * Register REST.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Routes. GET and POST (CMS tries GET then POST on 405).
	 */
	public static function register_routes(): void {
		register_rest_route(
			'escarlet-blog/v1',
			'/sync',
			array(
				array(
					'methods'             => array( 'GET', 'POST' ),
					'callback'            => array( __CLASS__, 'handle_sync' ),
					'permission_callback' => array( __CLASS__, 'check_auth' ),
				),
			)
		);
	}

	/**
	 * Bearer token must match webhook secret (same field as Coolify API token in CMS).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error
	 */
	public static function check_auth( WP_REST_Request $request ) {
		$expected = Escarlet_Blog_Client_Settings::webhook_secret();
		if ( ! $expected ) {
			return new WP_Error( 'escarlet_no_secret', 'Webhook secret missing', array( 'status' => 500 ) );
		}

		$auth = $request->get_header( 'authorization' );
		$token = '';
		if ( is_string( $auth ) && 0 === stripos( $auth, 'Bearer ' ) ) {
			$token = trim( substr( $auth, 7 ) );
		}
		if ( '' === $token ) {
			$token = (string) $request->get_header( 'x-escarlet-webhook-token' );
		}
		// CMS may append ?force=true; ignore. Also allow query token for diagnostics.
		if ( '' === $token ) {
			$token = (string) $request->get_param( 'token' );
		}

		if ( ! $token || ! hash_equals( $expected, $token ) ) {
			return new WP_Error( 'escarlet_forbidden', 'Unauthorized', array( 'status' => 401 ) );
		}
		return true;
	}

	/**
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_sync( WP_REST_Request $request ) {
		$result = Escarlet_Blog_Client_Sync::run();
		$status = ! empty( $result['ok'] ) ? 200 : 502;
		return new WP_REST_Response( $result, $status );
	}
}
