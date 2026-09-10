<?php
/**
 * /blog archive and /blog/{slug} for managed posts.
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Permalinks and query vars.
 */
final class Escarlet_Blog_Client_Permalinks {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'init', array( __CLASS__, 'register_rewrites' ), 20 );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'pre_get_posts', array( __CLASS__, 'pre_get_posts' ) );
		add_filter( 'post_link', array( __CLASS__, 'post_link' ), 10, 2 );
		add_filter( 'post_type_link', array( __CLASS__, 'post_link' ), 10, 2 );
		add_filter( 'document_title_parts', array( __CLASS__, 'archive_title' ) );
	}

	/**
	 * Rewrite rules.
	 */
	public static function register_rewrites(): void {
		add_rewrite_rule( '^blog/?$', 'index.php?escarlet_blog_archive=1', 'top' );
		add_rewrite_rule( '^blog/page/([0-9]+)/?$', 'index.php?escarlet_blog_archive=1&paged=$matches[1]', 'top' );
		add_rewrite_rule( '^blog/([^/]+)/?$', 'index.php?escarlet_blog_post=$matches[1]', 'top' );
	}

	/**
	 * @param string[] $vars Vars.
	 * @return string[]
	 */
	public static function query_vars( array $vars ): array {
		$vars[] = 'escarlet_blog_archive';
		$vars[] = 'escarlet_blog_post';
		return $vars;
	}

	/**
	 * @param WP_Query $query Query.
	 */
	public static function pre_get_posts( WP_Query $query ): void {
		if ( is_admin() || ! $query->is_main_query() ) {
			return;
		}

		$slug = get_query_var( 'escarlet_blog_post' );
		if ( $slug ) {
			$query->set( 'name', sanitize_title( (string) $slug ) );
			$query->set( 'post_type', 'post' );
			$query->set( 'post_status', 'publish' );
			$query->set(
				'meta_query',
				array(
					array(
						'key'   => Escarlet_Blog_Client_Sync::META_MANAGED,
						'value' => '1',
					),
				)
			);
			$query->is_single            = true;
			$query->is_singular          = true;
			$query->is_home              = false;
			$query->is_archive           = false;
			$query->is_posts_page        = false;
			return;
		}

		if ( get_query_var( 'escarlet_blog_archive' ) ) {
			$query->set( 'post_type', 'post' );
			$query->set( 'post_status', 'publish' );
			$query->set(
				'meta_query',
				array(
					array(
						'key'   => Escarlet_Blog_Client_Sync::META_MANAGED,
						'value' => '1',
					),
				)
			);
			$query->set( 'posts_per_page', 10 );
			$query->is_home       = false;
			$query->is_archive    = true;
			$query->is_posts_page = false;
		}
	}

	/**
	 * Canonical public URL for managed posts.
	 *
	 * @param string      $permalink Permalink.
	 * @param WP_Post|int $post      Post.
	 * @return string
	 */
	public static function post_link( string $permalink, $post ): string {
		$post = get_post( $post );
		if ( ! $post || 'post' !== $post->post_type ) {
			return $permalink;
		}
		if ( ! Escarlet_Blog_Client_Sync::is_managed( (int) $post->ID ) ) {
			return $permalink;
		}
		$slug = (string) get_post_meta( $post->ID, Escarlet_Blog_Client_Sync::META_SLUG, true );
		if ( ! $slug ) {
			$slug = $post->post_name;
		}
		return home_url( user_trailingslashit( 'blog/' . $slug ) );
	}

	/**
	 * @param array $parts Title parts.
	 * @return array
	 */
	public static function archive_title( array $parts ): array {
		if ( get_query_var( 'escarlet_blog_archive' ) ) {
			$parts['title'] = __( 'Blog', 'escarlet-blog-client' );
		}
		return $parts;
	}
}
