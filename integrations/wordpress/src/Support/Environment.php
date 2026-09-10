<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Support;

final class Environment
{
    /** @return array<string, mixed> */
    public static function snapshot(): array
    {
        $theme = wp_get_theme();
        $activePlugins = (array) get_option('active_plugins', []);
        $networkPlugins = is_multisite() ? (array) get_site_option('active_sitewide_plugins', []) : [];
        $allActive = array_merge($activePlugins, array_keys($networkPlugins));
        $allActive = array_values(array_unique(array_map('strval', $allActive)));

        $elementorVersion = defined('ELEMENTOR_VERSION') ? (string) ELEMENTOR_VERSION : null;
        $elementorProVersion = defined('ELEMENTOR_PRO_VERSION') ? (string) ELEMENTOR_PRO_VERSION : null;
        $features = [];
        if ($elementorVersion) {
            $features[] = 'elementor_documents';
            $features[] = 'containers';
        }
        if ($elementorProVersion) {
            $features[] = 'theme_builder';
        }

        return [
            'wordpress' => [
                'version' => (string) get_bloginfo('version'),
                'multisite' => is_multisite(),
            ],
            'php' => ['version' => PHP_VERSION],
            'elementor' => [
                'installed' => self::pluginInstalled($allActive, 'elementor/elementor.php') || (bool) $elementorVersion,
                'active' => (bool) $elementorVersion,
                'version' => $elementorVersion,
            ],
            'elementorPro' => [
                'installed' => self::pluginInstalled($allActive, 'elementor-pro/elementor-pro.php') || (bool) $elementorProVersion,
                'active' => (bool) $elementorProVersion,
                'version' => $elementorProVersion,
            ],
            'woocommerce' => self::pluginInfo($allActive, 'woocommerce/woocommerce.php', 'woocommerce'),
            'acf' => self::pluginInfo($allActive, 'advanced-custom-fields/acf.php', 'advanced-custom-fields'),
            'theme' => [
                'name' => $theme->get('Name'),
                'version' => $theme->get('Version'),
            ],
            'features' => $features,
            'plugins' => [
                'activeCount' => count($allActive),
                'fingerprint' => 'sha256:' . hash('sha256', implode("\n", $allActive)),
            ],
            'externalWritesEnabled' => self::writesEnabled(),
        ];
    }

    public static function writesEnabled(): bool
    {
        $settings = (array) get_option('escarlet_eb_settings', []);
        return (bool) ($settings['external_writes_enabled'] ?? false);
    }

    /** @return array{active: bool, version: ?string} */
    private static function pluginInfo(array $activePlugins, string $pluginFile, string $constantPrefix): array
    {
        $constant = strtoupper(str_replace('-', '_', $constantPrefix)) . '_VERSION';
        return [
            'active' => self::pluginInstalled($activePlugins, $pluginFile) || defined($constant),
            'version' => defined($constant) ? (string) constant($constant) : null,
        ];
    }

    private static function pluginInstalled(array $activePlugins, string $pluginFile): bool
    {
        return in_array($pluginFile, $activePlugins, true);
    }
}
