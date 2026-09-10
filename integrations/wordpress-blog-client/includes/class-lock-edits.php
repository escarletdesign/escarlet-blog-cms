<?php
/**
 * Block local editing of CMS-managed posts (CMS is source of truth).
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lock edits.
 */
final class Escarlet_Blog_Client_Lock_Edits {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_notices', array( __CLASS__, 'edit_notice' ) );
		add_filter( 'use_block_editor_for_post', array( __CLASS__, 'maybe_disable_editor' ), 20, 2 );
		add_action( 'load-post.php', array( __CLASS__, 'maybe_redirect_edit' ) );
		add_filter( 'map_meta_cap', array( __CLASS__, 'map_meta_cap' ), 10, 4 );
		add_filter( 'post_row_actions', array( __CLASS__, 'row_actions' ), 10, 2 );
	}

	/**
	 * @param bool    $use   Use block editor.
	 * @param WP_Post $post  Post.
	 * @return bool
	 */
	public static function maybe_disable_editor( $use, $post ) {
		if ( $post instanceof WP_Post && Escarlet_Blog_Client_Sync::is_managed( (int) $post->ID ) ) {
			return false;
		}
		return $use;
	}

	/**
	 * Redirect classic edit screen to Escarlet hub.
	 */
	public static function maybe_redirect_edit(): void {
		if ( empty( $_GET['post'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$post_id = (int) $_GET['post']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return;
		}
		if ( ! empty( $_GET['escarlet_view'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		// Stay on a read-only notice screen (no force redirect) so admins can trash if needed.
	}

	/**
	 * Admin notice on edit screen.
	 */
	public static function edit_notice(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'post' !== $screen->base ) {
			return;
		}
		$post_id = isset( $_GET['post'] ) ? (int) $_GET['post'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! $post_id || ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return;
		}
		$slug = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_SLUG, true );
		$url  = Escarlet_Blog_Client_Admin::open_cms_url( $slug ? 'entrada/' . $slug : 'entradas' );
		echo '<div class="notice notice-warning"><p>';
		echo esc_html__( 'Esta entrada la gestiona el CMS Escarlet. Edítala allí (texto, portada, packs). Los cambios locales se sobrescriben en el próximo sync.', 'escarlet-blog-client' );
		if ( $url ) {
			echo ' <a class="button button-primary" href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer">';
			echo esc_html__( 'Abrir en Escarlet', 'escarlet-blog-client' );
			echo '</a>';
		}
		echo '</p></div>';
	}

	/**
	 * Soft-block edit_post for non-admins on managed posts (admins keep trash capability).
	 *
	 * @param string[] $caps    Caps.
	 * @param string   $cap     Cap.
	 * @param int      $user_id User.
	 * @param array    $args    Args.
	 * @return string[]
	 */
	public static function map_meta_cap( $caps, $cap, $user_id, $args ) {
		if ( 'edit_post' !== $cap && 'edit_page' !== $cap ) {
			return $caps;
		}
		$post_id = isset( $args[0] ) ? (int) $args[0] : 0;
		if ( ! $post_id || ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return $caps;
		}
		if ( user_can( $user_id, 'manage_options' ) ) {
			return $caps;
		}
		return array( 'do_not_allow' );
	}

	/**
	 * @param array   $actions Actions.
	 * @param WP_Post $post    Post.
	 * @return array
	 */
	public static function row_actions( $actions, $post ) {
		if ( ! Escarlet_Blog_Client_Sync::is_managed( (int) $post->ID ) ) {
			return $actions;
		}
		$slug = (string) get_post_meta( $post->ID, Escarlet_Blog_Client_Sync::META_SLUG, true );
		$url  = Escarlet_Blog_Client_Admin::open_cms_url( $slug ? 'entrada/' . $slug : 'entradas' );
		if ( $url ) {
			$actions['escarlet_cms'] = '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Editar en Escarlet', 'escarlet-blog-client' ) . '</a>';
		}
		unset( $actions['inline hide-if-no-js'] );
		return $actions;
	}
}
