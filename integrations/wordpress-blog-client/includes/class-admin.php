<?php
/**
 * wp-admin screens. settings, sync, open CMS (SSO), packs via CMS.
 *
 * @package Escarlet_Blog_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin UI.
 */
final class Escarlet_Blog_Client_Admin {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'handle_actions' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	/**
	 * Menu.
	 */
	public static function menu(): void {
		add_menu_page(
			__( 'Escarlet Blog', 'escarlet-blog-client' ),
			__( 'Escarlet Blog', 'escarlet-blog-client' ),
			'manage_options',
			'escarlet-blog-client',
			array( __CLASS__, 'render_hub' ),
			'dashicons-welcome-write-blog',
			58
		);
		add_submenu_page(
			'escarlet-blog-client',
			__( 'Panel y packs', 'escarlet-blog-client' ),
			__( 'Panel y packs', 'escarlet-blog-client' ),
			'manage_options',
			'escarlet-blog-client',
			array( __CLASS__, 'render_hub' )
		);
		add_submenu_page(
			'escarlet-blog-client',
			__( 'Ajustes', 'escarlet-blog-client' ),
			__( 'Ajustes', 'escarlet-blog-client' ),
			'manage_options',
			'escarlet-blog-client-settings',
			array( __CLASS__, 'render_settings' )
		);
	}

	/**
	 * @param string $hook Hook.
	 */
	public static function assets( string $hook ): void {
		if ( false === strpos( $hook, 'escarlet-blog-client' ) ) {
			return;
		}
		wp_enqueue_style(
			'escarlet-blog-client-admin',
			ESCARLET_BLOG_CLIENT_URL . 'assets/admin.css',
			array(),
			ESCARLET_BLOG_CLIENT_VERSION
		);
	}

	/**
	 * Save settings / sync / regenerate secret / open CMS.
	 */
	public static function handle_actions(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		if ( isset( $_POST['escarlet_blog_save_settings'] ) ) {
			check_admin_referer( 'escarlet_blog_settings' );
			update_option(
				Escarlet_Blog_Client_Settings::OPTION_CMS_URL,
				Escarlet_Blog_Client_Settings::sanitize_url( wp_unslash( $_POST['cms_url'] ?? '' ) )
			);
			update_option(
				Escarlet_Blog_Client_Settings::OPTION_SITE_HANDLE,
				Escarlet_Blog_Client_Settings::sanitize_handle( wp_unslash( $_POST['site_handle'] ?? '' ) )
			);
			$token = isset( $_POST['site_token'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['site_token'] ) ) : '';
			if ( '' !== $token && '********' !== $token ) {
				update_option( Escarlet_Blog_Client_Settings::OPTION_SITE_TOKEN, $token );
			}
			add_settings_error( 'escarlet_blog_client', 'saved', __( 'Ajustes guardados.', 'escarlet-blog-client' ), 'success' );
		}

		if ( isset( $_POST['escarlet_blog_regen_webhook'] ) ) {
			check_admin_referer( 'escarlet_blog_settings' );
			update_option(
				Escarlet_Blog_Client_Settings::OPTION_WEBHOOK_SECRET,
				wp_generate_password( 48, false, false )
			);
			add_settings_error( 'escarlet_blog_client', 'webhook', __( 'Nuevo secreto de webhook generado. Pégalo otra vez en el CMS.', 'escarlet-blog-client' ), 'success' );
		}

		if ( isset( $_POST['escarlet_blog_sync_now'] ) ) {
			check_admin_referer( 'escarlet_blog_sync' );
			$result = Escarlet_Blog_Client_Sync::run();
			add_settings_error(
				'escarlet_blog_client',
				'sync',
				$result['message'],
				! empty( $result['ok'] ) ? 'success' : 'error'
			);
		}

		if ( isset( $_GET['escarlet_open_cms'] ) && '1' === $_GET['escarlet_open_cms'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			check_admin_referer( 'escarlet_open_cms' );
			$next = isset( $_GET['next'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['next'] ) ) : '/posts'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$url  = self::request_consume_url( $next );
			if ( is_wp_error( $url ) ) {
				add_settings_error( 'escarlet_blog_client', 'cms', $url->get_error_message(), 'error' );
				return;
			}
			wp_redirect( $url ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
			exit;
		}
	}

	/**
	 * Build admin URL that triggers SSO open.
	 *
	 * @param string $next App route e.g. /manual/slug.
	 * @return string
	 */
	public static function open_cms_url( string $next = '/posts' ): string {
		if ( ! Escarlet_Blog_Client_Settings::can_open_cms() ) {
			return '';
		}
		$next = ltrim( $next, '#' );
		if ( '' === $next ) {
			$next = '/posts';
		}
		return wp_nonce_url(
			add_query_arg(
				array(
					'page'              => 'escarlet-blog-client',
					'escarlet_open_cms' => '1',
					'next'              => $next,
				),
				admin_url( 'admin.php' )
			),
			'escarlet_open_cms'
		);
	}

	/**
	 * Ask CMS for one-time consume URL.
	 *
	 * @param string $next Next hash.
	 * @return string|WP_Error
	 */
	public static function request_consume_url( string $next = '/posts' ) {
		if ( ! Escarlet_Blog_Client_Settings::can_open_cms() ) {
			return new WP_Error( 'escarlet_config', __( 'Falta URL del CMS, handle o token de sitio.', 'escarlet-blog-client' ) );
		}

		$endpoint = Escarlet_Blog_Client_Settings::cms_url() . '/api/embed/session';
		$res      = wp_remote_post(
			$endpoint,
			array(
				'timeout' => 20,
				'headers' => array(
					'Authorization' => 'Bearer ' . Escarlet_Blog_Client_Settings::site_token(),
					'Content-Type'  => 'application/json',
					'Accept'        => 'application/json',
				),
				'body'    => wp_json_encode(
					array(
						'next' => $next,
						'site' => Escarlet_Blog_Client_Settings::site_handle(),
					)
				),
			)
		);

		if ( is_wp_error( $res ) ) {
			return $res;
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		if ( $code < 200 || $code >= 300 || empty( $data['consumeUrl'] ) ) {
			$msg = is_array( $data ) && ! empty( $data['message'] )
				? (string) $data['message']
				: sprintf( /* translators: HTTP status */ __( 'El CMS no pudo crear la sesión (HTTP %d).', 'escarlet-blog-client' ), $code );
			return new WP_Error( 'escarlet_sso', $msg );
		}

		return (string) $data['consumeUrl'];
	}

	/**
	 * Hub. open CMS + packs + sync.
	 */
	public static function render_hub(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		settings_errors( 'escarlet_blog_client' );
		$open_url   = self::open_cms_url( '/posts' );
		$packs_note = __( 'Los packs (Substack, LinkedIn, X, guion, carrusel) viven en el CMS Escarlet. Ábrelos desde el panel. WordPress no genera HTML estático de packs.', 'escarlet-blog-client' );
		$posts      = self::list_managed_posts();
		?>
		<div class="wrap escarlet-blog-wrap">
			<h1><?php esc_html_e( 'Escarlet Blog', 'escarlet-blog-client' ); ?></h1>
			<p class="escarlet-lead">
				<?php esc_html_e( 'El CMS Escarlet es la fuente de verdad. Aquí solo sincronizas el blog público y abres el panel para editar y usar packs.', 'escarlet-blog-client' ); ?>
			</p>

			<div class="escarlet-cards">
				<div class="escarlet-card">
					<h2><?php esc_html_e( 'Panel Escarlet', 'escarlet-blog-client' ); ?></h2>
					<p><?php esc_html_e( 'Edición, brand kit, publicación y social packs con tu token de sitio.', 'escarlet-blog-client' ); ?></p>
					<?php if ( $open_url ) : ?>
						<p>
							<a class="button button-primary button-hero" href="<?php echo esc_url( $open_url ); ?>">
								<?php esc_html_e( 'Abrir panel Escarlet', 'escarlet-blog-client' ); ?>
							</a>
						</p>
					<?php else : ?>
						<p class="escarlet-warn"><?php esc_html_e( 'Configura URL, handle y token de sitio en Ajustes.', 'escarlet-blog-client' ); ?></p>
					<?php endif; ?>
					<p class="description"><?php echo esc_html( $packs_note ); ?></p>
				</div>

				<div class="escarlet-card">
					<h2><?php esc_html_e( 'Sincronizar blog público', 'escarlet-blog-client' ); ?></h2>
					<p><?php esc_html_e( 'Baja los posts published del CMS a entradas de WordPress en /blog.', 'escarlet-blog-client' ); ?></p>
					<form method="post">
						<?php wp_nonce_field( 'escarlet_blog_sync' ); ?>
						<button type="submit" name="escarlet_blog_sync_now" class="button button-secondary" value="1">
							<?php esc_html_e( 'Sincronizar ahora', 'escarlet-blog-client' ); ?>
						</button>
					</form>
					<?php self::render_last_sync(); ?>
				</div>
			</div>

			<h2><?php esc_html_e( 'Entradas sincronizadas', 'escarlet-blog-client' ); ?></h2>
			<?php if ( empty( $posts ) ) : ?>
				<p><?php esc_html_e( 'Aún no hay posts. Publica en el CMS y sincroniza (o espera el webhook).', 'escarlet-blog-client' ); ?></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Título', 'escarlet-blog-client' ); ?></th>
							<th><?php esc_html_e( 'Slug', 'escarlet-blog-client' ); ?></th>
							<th><?php esc_html_e( 'Público', 'escarlet-blog-client' ); ?></th>
							<th><?php esc_html_e( 'Pack / CMS', 'escarlet-blog-client' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $posts as $row ) : ?>
							<tr>
								<td><?php echo esc_html( $row['title'] ); ?></td>
								<td><code><?php echo esc_html( $row['slug'] ); ?></code></td>
								<td>
									<?php if ( $row['permalink'] ) : ?>
										<a href="<?php echo esc_url( $row['permalink'] ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Ver', 'escarlet-blog-client' ); ?></a>
									<?php endif; ?>
								</td>
								<td>
									<?php if ( $row['open_url'] ) : ?>
										<a href="<?php echo esc_url( $row['open_url'] ); ?>">
											<?php echo $row['has_pack'] ? esc_html__( 'Abrir pack en CMS', 'escarlet-blog-client' ) : esc_html__( 'Abrir en CMS', 'escarlet-blog-client' ); ?>
										</a>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Settings page.
	 */
	public static function render_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		settings_errors( 'escarlet_blog_client' );
		$cms     = Escarlet_Blog_Client_Settings::cms_url();
		$handle  = Escarlet_Blog_Client_Settings::site_handle();
		$token   = Escarlet_Blog_Client_Settings::site_token();
		$secret  = Escarlet_Blog_Client_Settings::webhook_secret();
		$hook    = Escarlet_Blog_Client_Settings::webhook_url();
		?>
		<div class="wrap escarlet-blog-wrap">
			<h1><?php esc_html_e( 'Ajustes Escarlet Blog', 'escarlet-blog-client' ); ?></h1>
			<form method="post">
				<?php wp_nonce_field( 'escarlet_blog_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="cms_url"><?php esc_html_e( 'URL del CMS', 'escarlet-blog-client' ); ?></label></th>
						<td>
							<input name="cms_url" id="cms_url" type="url" class="regular-text" value="<?php echo esc_attr( $cms ); ?>" required />
							<p class="description"><?php esc_html_e( 'Ejemplo. https://blog-cms.escarlet.cc', 'escarlet-blog-client' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="site_handle"><?php esc_html_e( 'Handle del sitio', 'escarlet-blog-client' ); ?></label></th>
						<td>
							<input name="site_handle" id="site_handle" type="text" class="regular-text" value="<?php echo esc_attr( $handle ); ?>" required pattern="[a-z0-9\-]+" />
							<p class="description"><?php esc_html_e( 'El mismo handle del CMS (kebab-case).', 'escarlet-blog-client' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="site_token"><?php esc_html_e( 'Token de sitio', 'escarlet-blog-client' ); ?></label></th>
						<td>
							<input name="site_token" id="site_token" type="password" class="regular-text" value="<?php echo $token ? '********' : ''; ?>" autocomplete="new-password" />
							<p class="description"><?php esc_html_e( 'CMS → Sitio → Token de acceso del cliente. Sirve para abrir el panel desde aquí.', 'escarlet-blog-client' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button( __( 'Guardar ajustes', 'escarlet-blog-client' ), 'primary', 'escarlet_blog_save_settings' ); ?>
			</form>

			<hr />
			<h2><?php esc_html_e( 'Webhook de sync (pegar en el CMS)', 'escarlet-blog-client' ); ?></h2>
			<p><?php esc_html_e( 'En el CMS, tab Sitio. pega esta URL como Deploy webhook y el secreto como Token API (Bearer). Al publicar, el CMS dispara el sync de WordPress en lugar de Coolify.', 'escarlet-blog-client' ); ?></p>
			<p><label><?php esc_html_e( 'URL', 'escarlet-blog-client' ); ?></label><br />
				<code class="escarlet-code"><?php echo esc_html( $hook ); ?></code>
			</p>
			<p><label><?php esc_html_e( 'Bearer / Token API', 'escarlet-blog-client' ); ?></label><br />
				<code class="escarlet-code"><?php echo esc_html( $secret ); ?></code>
			</p>
			<form method="post">
				<?php wp_nonce_field( 'escarlet_blog_settings' ); ?>
				<?php submit_button( __( 'Regenerar secreto', 'escarlet-blog-client' ), 'secondary', 'escarlet_blog_regen_webhook', false ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Last sync status.
	 */
	private static function render_last_sync(): void {
		$err  = (string) get_option( Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC_ERROR, '' );
		$raw  = (string) get_option( Escarlet_Blog_Client_Settings::OPTION_LAST_SYNC, '' );
		$data = json_decode( $raw, true );
		if ( $err ) {
			echo '<p class="escarlet-warn">' . esc_html( $err ) . '</p>';
			return;
		}
		if ( is_array( $data ) && ! empty( $data['at'] ) ) {
			echo '<p class="description">' . esc_html(
				sprintf(
					/* translators: 1: datetime, 2: count */
					__( 'Último sync %1$s (%2$s).', 'escarlet-blog-client' ),
					$data['at'],
					isset( $data['count'] ) ? (string) $data['count'] : '—'
				)
			) . '</p>';
		}
	}

	/**
	 * @return array<int,array{title:string,slug:string,permalink:string,open_url:string,has_pack:bool}>
	 */
	private static function list_managed_posts(): array {
		$q = new WP_Query(
			array(
				'post_type'      => 'post',
				'post_status'    => array( 'publish', 'draft' ),
				'posts_per_page' => 100,
				'meta_key'       => Escarlet_Blog_Client_Sync::META_MANAGED,
				'meta_value'     => '1',
				'orderby'        => 'date',
				'order'          => 'DESC',
			)
		);
		$out = array();
		foreach ( $q->posts as $post ) {
			$slug = (string) get_post_meta( $post->ID, Escarlet_Blog_Client_Sync::META_SLUG, true );
			$pack = (string) get_post_meta( $post->ID, Escarlet_Blog_Client_Sync::META_SOCIAL_PACK, true );
			$out[] = array(
				'title'     => get_the_title( $post ),
				'slug'      => $slug ?: $post->post_name,
				'permalink' => get_permalink( $post ),
				'open_url'  => self::open_cms_url( $slug ? '/preview/' . $slug : '/posts' ),
				'has_pack'  => (bool) $pack,
			);
		}
		return $out;
	}
}
