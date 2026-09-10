<?php
/**
 * SEO meta for managed posts (title, description, OG image).
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Front SEO helpers.
 */
final class Escarlet_Blog_Client_Seo {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_filter( 'document_title_parts', array( __CLASS__, 'title_parts' ) );
		add_action( 'wp_head', array( __CLASS__, 'head_meta' ), 5 );
		add_filter( 'get_the_excerpt', array( __CLASS__, 'excerpt' ), 10, 2 );
		add_filter( 'post_thumbnail_html', array( __CLASS__, 'thumbnail_html' ), 10, 5 );
		add_filter( 'has_post_thumbnail', array( __CLASS__, 'has_thumbnail' ), 10, 2 );
	}

	/**
	 * @param array $parts Parts.
	 * @return array
	 */
	public static function title_parts( array $parts ): array {
		if ( ! is_singular( 'post' ) ) {
			return $parts;
		}
		$post_id = get_queried_object_id();
		if ( ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return $parts;
		}
		$custom = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_META_TITLE, true );
		if ( $custom ) {
			$parts['title'] = $custom;
		}
		return $parts;
	}

	/**
	 * Meta description + OG.
	 */
	public static function head_meta(): void {
		if ( ! is_singular( 'post' ) ) {
			return;
		}
		$post_id = get_queried_object_id();
		if ( ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return;
		}
		$desc  = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_META_DESC, true );
		$title = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_META_TITLE, true );
		$image = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_IMAGE_URL, true );
		$url   = get_permalink( $post_id );

		if ( $desc ) {
			echo '<meta name="description" content="' . esc_attr( $desc ) . '" />' . "\n";
		}
		if ( $title ) {
			echo '<meta property="og:title" content="' . esc_attr( $title ) . '" />' . "\n";
		}
		if ( $desc ) {
			echo '<meta property="og:description" content="' . esc_attr( $desc ) . '" />' . "\n";
		}
		if ( $url ) {
			echo '<meta property="og:url" content="' . esc_url( $url ) . '" />' . "\n";
			echo '<link rel="canonical" href="' . esc_url( $url ) . '" />' . "\n";
		}
		if ( $image ) {
			echo '<meta property="og:image" content="' . esc_url( $image ) . '" />' . "\n";
			echo '<meta name="twitter:image" content="' . esc_url( $image ) . '" />' . "\n";
		}
		echo '<meta property="og:type" content="article" />' . "\n";
	}

	/**
	 * @param string  $excerpt Excerpt.
	 * @param WP_Post $post    Post.
	 * @return string
	 */
	public static function excerpt( $excerpt, $post ) {
		if ( ! $post instanceof WP_Post || ! Escarlet_Blog_Client_Sync::is_managed( (int) $post->ID ) ) {
			return $excerpt;
		}
		$desc = (string) get_post_meta( $post->ID, Escarlet_Blog_Client_Sync::META_META_DESC, true );
		return $desc ? $desc : $excerpt;
	}

	/**
	 * @param bool $has Has thumb.
	 * @param int  $post_id Post ID.
	 * @return bool
	 */
	public static function has_thumbnail( $has, $post_id ) {
		if ( $has ) {
			return $has;
		}
		$post_id = (int) $post_id;
		if ( ! Escarlet_Blog_Client_Sync::is_managed( $post_id ) ) {
			return $has;
		}
		return (bool) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_IMAGE_URL, true );
	}

	/**
	 * Remote cover when no local attachment.
	 *
	 * @param string       $html HTML.
	 * @param int          $post_id Post.
	 * @param int          $thumb_id Thumb.
	 * @param string|int[] $size Size.
	 * @param string|array $attr Attr.
	 * @return string
	 */
	public static function thumbnail_html( $html, $post_id, $thumb_id, $size, $attr ) {
		if ( $html ) {
			return $html;
		}
		if ( ! Escarlet_Blog_Client_Sync::is_managed( (int) $post_id ) ) {
			return $html;
		}
		$url = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_IMAGE_URL, true );
		if ( ! $url ) {
			return $html;
		}
		$alt = (string) get_post_meta( $post_id, Escarlet_Blog_Client_Sync::META_IMAGE_ALT, true );
		return sprintf(
			'<img src="%s" alt="%s" class="wp-post-image escarlet-remote-cover" loading="lazy" decoding="async" />',
			esc_url( $url ),
			esc_attr( $alt )
		);
	}
}
