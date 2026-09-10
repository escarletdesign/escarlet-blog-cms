<?php
/**
 * Sync published posts from Escarlet CMS → native WP posts.
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Sync service.
 */
final class Escarlet_Blog_Client_Sync {

	public const META_MANAGED     = '_escarlet_managed';
	public const META_SLUG        = '_escarlet_cms_slug';
	public const META_SYNCED_AT   = '_escarlet_synced_at';
	public const META_SOCIAL_PACK = '_escarlet_social_pack';
	public const META_META_TITLE  = '_escarlet_meta_title';
	public const META_META_DESC   = '_escarlet_meta_description';
	public const META_IMAGE_URL   = '_escarlet_image_url';
	public const META_IMAGE_ALT   = '_escarlet_image_alt';
	public const META_ATTACHMENT_ID = '_escarlet_image_attachment_id';
	public const META_AUTHOR_NAME = '_escarlet_author_name';

	/**
	 * Pull public API and upsert posts.
	 *
	 * @return array{ok:bool,message:string,imported?:int,removed?:int,blog_enabled?:bool}
	 */
	public static function run(): array {
		$cms  = Escarlet_Blog_Client_Settings::cms_url();
		$site = Escarlet_Blog_Client_Settings::site_handle();

		if ( ! $cms || ! $site ) {
			return array(
				'ok'      => false,
				'message' => 'Configura la URL del CMS y el handle del sitio.',
			);
		}

		$url = $cms . '/api/sites/' . rawurlencode( $site ) . '/posts';
		$res = wp_remote_get(
			$url,
			array(
				'timeout' => 30,
				'headers' => array( 'Accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $res ) ) {
			self::store_error( $res->get_error_message() );
			return array(
				'ok'      => false,
				'message' => $res->get_error_message(),
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );

		if ( 404 === $code && is_array( $body ) && isset( $body['blogEnabled'] ) && false === $body['blogEnabled'] ) {
			$removed = self::unpublish_all_managed();
			self::store_success( $removed );
			return array(
				'ok'           => true,
				'message'      => 'Blog apagado en el CMS. Posts públicos vaciados en WordPress.',
				'imported'     => 0,
				'removed'      => $removed,
				'blog_enabled' => false,
			);
		}

		if ( $code < 200 || $code >= 300 || ! is_array( $body ) ) {
			$msg = is_array( $body ) && ! empty( $body['message'] )
				? (string) $body['message']
				: 'HTTP ' . $code;
			self::store_error( $msg );
			return array(
				'ok'      => false,
				'message' => $msg,
			);
		}

		$blog_enabled = ! isset( $body['blogEnabled'] ) || false !== $body['blogEnabled'];
		$posts        = isset( $body['posts'] ) && is_array( $body['posts'] ) ? $body['posts'] : array();

		if ( ! $blog_enabled ) {
			$removed = self::unpublish_all_managed();
			self::store_success( $removed );
			return array(
				'ok'           => true,
				'message'      => 'Blog apagado en el CMS. Posts públicos vaciados en WordPress.',
				'imported'     => 0,
				'removed'      => $removed,
				'blog_enabled' => false,
			);
		}

		$seen     = array();
		$imported = 0;
		foreach ( $posts as $post ) {
			if ( ! is_array( $post ) || empty( $post['slug'] ) ) {
				continue;
			}
			$slug          = sanitize_title( (string) $post['slug'] );
			$seen[ $slug ] = true;
			self::upsert_post( $post, $cms );
			++$imported;
		}

		$removed = self::remove_missing( array_keys( $seen ) );
		self::store_success( $imported );

		return array(
			'ok'           => true,
			'message'      => sprintf(
				/* translators: 1: imported count, 2: removed count */
				__( 'Sincronizados %1$d posts. Quitados %2$d.', 'escarlet-blog-client' ),
				$imported,
				$removed
			),
			'imported'     => $imported,
			'removed'      => $removed,
			'blog_enabled' => true,
		);
	}

	/**
	 * @param array  $post CMS public post.
	 * @param string $cms  CMS base URL.
	 */
	private static function upsert_post( array $post, string $cms ): void {
		$slug  = sanitize_title( (string) $post['slug'] );
		$title = $post['title'] ?? $slug;
		if ( is_array( $title ) ) {
			$title = (string) ( $title['es'] ?? reset( $title ) ?: $slug );
		} else {
			$title = (string) $title;
		}

		$existing = self::find_managed_by_slug( $slug );
		$body     = (string) ( $post['bodyHtml'] ?? '' );
		$excerpt  = (string) ( $post['excerptEs'] ?? '' );
		$status   = 'publish';

		$date = self::normalize_date( $post['datePublished'] ?? '' );
		$mod  = self::normalize_date( $post['dateModified'] ?? $post['datePublished'] ?? '' );

		$payload = array(
			'post_type'     => 'post',
			'post_status'   => $status,
			'post_title'    => wp_strip_all_tags( $title ),
			'post_name'     => $slug,
			'post_content'  => wp_kses_post( $body ),
			'post_excerpt'  => wp_strip_all_tags( $excerpt ),
			'post_date'     => $date,
			'post_date_gmt' => get_gmt_from_date( $date ),
		);

		if ( $existing ) {
			$payload['ID'] = $existing;
			$post_id       = wp_update_post( $payload, true );
		} else {
			$post_id = wp_insert_post( $payload, true );
		}

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return;
		}

		$image_url = self::absolute_media_url( (string) ( $post['imageUrl'] ?? '' ), $cms );
		$image_alt = (string) ( $post['imageAlt'] ?? $title );

		update_post_meta( $post_id, self::META_MANAGED, '1' );
		update_post_meta( $post_id, self::META_SLUG, $slug );
		update_post_meta( $post_id, self::META_SYNCED_AT, gmdate( 'c' ) );
		update_post_meta( $post_id, self::META_IMAGE_URL, $image_url );
		update_post_meta( $post_id, self::META_IMAGE_ALT, $image_alt );
		update_post_meta( $post_id, self::META_AUTHOR_NAME, (string) ( $post['authorName'] ?? '' ) );

		$meta_title = $post['metaTitle'] ?? '';
		if ( is_array( $meta_title ) ) {
			$meta_title = (string) ( $meta_title['es'] ?? reset( $meta_title ) ?: '' );
		}
		$meta_desc = $post['metaDescription'] ?? '';
		if ( is_array( $meta_desc ) ) {
			$meta_desc = (string) ( $meta_desc['es'] ?? reset( $meta_desc ) ?: '' );
		}
		update_post_meta( $post_id, self::META_META_TITLE, wp_strip_all_tags( (string) $meta_title ) );
		update_post_meta( $post_id, self::META_META_DESC, wp_strip_all_tags( (string) $meta_desc ) );

		$pack = isset( $post['socialPack'] ) && is_array( $post['socialPack'] ) ? $post['socialPack'] : null;
		if ( $pack ) {
			update_post_meta( $post_id, self::META_SOCIAL_PACK, wp_json_encode( $pack ) );
		} else {
			delete_post_meta( $post_id, self::META_SOCIAL_PACK );
		}

		// Native post + Media Library attachment. No Elementor metadata is used.
		if ( $image_url ) {
			$attachment_id = self::ensure_attachment( $post_id, $image_url, $image_alt, $slug );
			if ( $attachment_id ) {
				set_post_thumbnail( $post_id, $attachment_id );
				update_post_meta( $post_id, self::META_ATTACHMENT_ID, $attachment_id );
			}
		}

		if ( $mod ) {
			wp_update_post(
				array(
					'ID'                => $post_id,
					'post_modified'     => $mod,
					'post_modified_gmt' => get_gmt_from_date( $mod ),
				)
			);
		}
	}

	/** Download or reuse a CMS cover in the native WordPress Media Library. */
	private static function ensure_attachment( int $post_id, string $url, string $alt, string $slug ): int {
		$existing = (int) get_post_meta( $post_id, self::META_ATTACHMENT_ID, true );
		if ( $existing && 'inherit' === get_post_status( $existing ) && (string) get_post_meta( $existing, '_escarlet_source_url', true ) === $url ) {
			update_post_meta( $existing, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
			return $existing;
		}

		if ( ! function_exists( 'media_sideload_image' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}

		$attachment_id = media_sideload_image( esc_url_raw( $url ), $post_id, sanitize_text_field( $slug ), 'id' );
		if ( is_wp_error( $attachment_id ) || ! $attachment_id ) {
			return 0;
		}
		update_post_meta( (int) $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
		update_post_meta( (int) $attachment_id, '_escarlet_source_url', esc_url_raw( $url ) );
		return (int) $attachment_id;
	}

	/**
	 * @param string $slug CMS slug.
	 * @return int Post ID or 0.
	 */
	public static function find_managed_by_slug( string $slug ): int {
		$q = new WP_Query(
			array(
				'post_type'      => 'post',
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_query'     => array(
					'relation' => 'AND',
					array(
						'key'   => self::META_MANAGED,
						'value' => '1',
					),
					array(
						'key'   => self::META_SLUG,
						'value' => $slug,
					),
				),
			)
		);
		return ! empty( $q->posts[0] ) ? (int) $q->posts[0] : 0;
	}

	/**
	 * @param string[] $keep_slugs Slugs still present in CMS.
	 */
	private static function remove_missing( array $keep_slugs ): int {
		$q = new WP_Query(
			array(
				'post_type'      => 'post',
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'meta_key'       => self::META_MANAGED,
				'meta_value'     => '1',
			)
		);
		$removed = 0;
		foreach ( $q->posts as $id ) {
			$slug = (string) get_post_meta( (int) $id, self::META_SLUG, true );
			if ( $slug && in_array( $slug, $keep_slugs, true ) ) {
				continue;
			}
			wp_trash_post( (int) $id );
			++$removed;
		}
		return $removed;
	}

	private static function unpublish_all_managed(): int {
		$q = new WP_Query(
			array(
				'post_type'      => 'post',
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'meta_key'       => self::META_MANAGED,
				'meta_value'     => '1',
			)
		);
		$count = 0;
		foreach ( $q->posts as $id ) {
			wp_update_post(
				array(
					'ID'          => (int) $id,
					'post_status' => 'draft',
				)
			);
			++$count;
		}
		return $count;
	}

	private static function absolute_media_url( string $image_url, string $cms ): string {
		$raw = trim( $image_url );
		if ( '' === $raw ) {
			return '';
		}
		if ( preg_match( '#^https?://#i', $raw ) ) {
			return esc_url_raw( $raw );
		}
		if ( 0 === strpos( $raw, '/media/' ) ) {
			return esc_url_raw( untrailingslashit( $cms ) . $raw );
		}
		return esc_url_raw( $raw );
	}

	private static function normalize_date( string $raw ): string {
		$raw = trim( $raw );
		if ( '' === $raw ) {
			return current_time( 'mysql' );
		}
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $raw ) ) {
			return $raw . ' 10:00:00';
		}
		$ts = strtotime( $raw );
		if ( false === $ts ) {
			return current_time( 'mysql' );
		}
		return gmdate( 'Y-m-d H:i:s', $ts );
	}

	private static function store_error( string $message ): void {
		update_option( Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC_ERROR, $message );
		update_option( Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC, gmdate( 'c' ) );
	}

	private static function store_success( int $count ): void {
		update_option( Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC_ERROR, '' );
		update_option(
			Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC,
			wp_json_encode(
				array(
					'at'    => gmdate( 'c' ),
					'count' => $count,
				)
			)
		);
	}

	/**
	 * Whether a WP post is managed by Escarlet.
	 */
	public static function is_managed( int $post_id ): bool {
		return '1' === (string) get_post_meta( $post_id, self::META_MANAGED, true );
	}
}
