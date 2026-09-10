<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Admin;

use Escarlet\ElementorBridge\Elementor\ElementorAdapter;
use Escarlet\ElementorBridge\Revisions\CheckpointRepository;
use Escarlet\ElementorBridge\Support\AuditLog;
use Escarlet\ElementorBridge\Support\Environment;

final class AdminPage
{
    public function __construct(
        private readonly ElementorAdapter $elementor,
        private readonly CheckpointRepository $checkpoints,
        private readonly AuditLog $audit = new AuditLog(),
    ) {
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_post_escarlet_eb_save_settings', [$this, 'saveSettings']);
        add_action('admin_post_escarlet_eb_regenerate_css', [$this, 'regenerateCss']);
    }

    public function menu(): void
    {
        add_options_page(
            'Escarlet Elementor Bridge',
            'Escarlet Elementor Bridge',
            'manage_options',
            'escarlet-elementor-bridge',
            [$this, 'render'],
        );
    }

    public function render(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('No tienes permisos suficientes.', 'escarlet-elementor-bridge'));
        }
        $settings = (array) get_option('escarlet_eb_settings', []);
        $environment = Environment::snapshot();
        $audit = $this->audit->recent(10);
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('Escarlet Elementor Bridge', 'escarlet-elementor-bridge'); ?></h1>
            <p><?php echo esc_html__('Estado del bridge para integraciones Codex/Cursor.', 'escarlet-elementor-bridge'); ?></p>
            <table class="widefat striped" style="max-width:900px">
                <tbody>
                <tr><td><?php esc_html_e('Plugin', 'escarlet-elementor-bridge'); ?></td><td><?php echo esc_html(ESCARLET_EB_VERSION); ?></td></tr>
                <tr><td><?php esc_html_e('REST base', 'escarlet-elementor-bridge'); ?></td><td><code><?php echo esc_html(rest_url('escarlet-elementor/v1')); ?></code></td></tr>
                <tr><td><?php esc_html_e('Elementor', 'escarlet-elementor-bridge'); ?></td><td><?php echo esc_html(($environment['elementor']['active'] ? 'Activo ' . $environment['elementor']['version'] : 'No activo')); ?></td></tr>
                <tr><td><?php esc_html_e('Elementor Pro', 'escarlet-elementor-bridge'); ?></td><td><?php echo esc_html(($environment['elementorPro']['active'] ? 'Activo ' . $environment['elementorPro']['version'] : 'No activo')); ?></td></tr>
                <tr><td><?php esc_html_e('Tema', 'escarlet-elementor-bridge'); ?></td><td><?php echo esc_html($environment['theme']['name'] . ' ' . $environment['theme']['version']); ?></td></tr>
                </tbody>
            </table>

            <h2><?php esc_html_e('Seguridad y retención', 'escarlet-elementor-bridge'); ?></h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="escarlet_eb_save_settings">
                <?php wp_nonce_field('escarlet_eb_save_settings'); ?>
                <p><label><input type="checkbox" name="external_writes_enabled" value="1" <?php checked(! empty($settings['external_writes_enabled'])); ?>> <?php esc_html_e('Permitir escrituras externas', 'escarlet-elementor-bridge'); ?></label></p>
                <p><label><?php esc_html_e('Checkpoints a conservar por documento', 'escarlet-elementor-bridge'); ?> <input type="number" name="checkpoint_retention" min="1" max="500" value="<?php echo esc_attr((string) ($settings['checkpoint_retention'] ?? 25)); ?>"></label></p>
                <?php submit_button(__('Guardar configuración', 'escarlet-elementor-bridge')); ?>
            </form>

            <h2><?php esc_html_e('Herramientas', 'escarlet-elementor-bridge'); ?></h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="escarlet_eb_regenerate_css">
                <?php wp_nonce_field('escarlet_eb_regenerate_css'); ?>
                <?php submit_button(__('Regenerar CSS y datos de Elementor', 'escarlet-elementor-bridge'), 'secondary'); ?>
            </form>

            <h2><?php esc_html_e('Últimas acciones', 'escarlet-elementor-bridge'); ?></h2>
            <pre style="max-width:900px;overflow:auto"><?php echo esc_html(wp_json_encode($audit, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); ?></pre>
        </div>
        <?php
    }

    public function saveSettings(): void
    {
        if (! current_user_can('manage_options') || ! check_admin_referer('escarlet_eb_save_settings')) {
            wp_die(esc_html__('Solicitud no autorizada.', 'escarlet-elementor-bridge'));
        }
        $settings = (array) get_option('escarlet_eb_settings', []);
        $settings['external_writes_enabled'] = isset($_POST['external_writes_enabled']);
        $settings['checkpoint_retention'] = max(1, min(500, absint($_POST['checkpoint_retention'] ?? 25)));
        update_option('escarlet_eb_settings', $settings, false);
        wp_safe_redirect(add_query_arg(['page' => 'escarlet-elementor-bridge', 'updated' => '1'], admin_url('options-general.php')));
        exit;
    }

    public function regenerateCss(): void
    {
        if (! current_user_can('manage_options') || ! check_admin_referer('escarlet_eb_regenerate_css')) {
            wp_die(esc_html__('Solicitud no autorizada.', 'escarlet-elementor-bridge'));
        }
        $result = $this->elementor->regenerateCss();
        if ($result instanceof \WP_Error) {
            wp_die(esc_html($result->get_error_message()));
        }
        $this->audit->record('admin.elementor.regenerate_css');
        wp_safe_redirect(add_query_arg(['page' => 'escarlet-elementor-bridge', 'css_regenerated' => '1'], admin_url('options-general.php')));
        exit;
    }
}

