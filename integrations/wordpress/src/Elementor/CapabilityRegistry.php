<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Elementor;

use Escarlet\ElementorBridge\Support\Environment;
use Throwable;

final class CapabilityRegistry
{
    private const OPTION = 'escarlet_eb_capabilities';
    private const CACHE_TTL = 21600;

    /** Widgets with explicit neutral semantic mappings in NodeConverter. */
    private const VERIFIED_WIDGETS = [
        'heading', 'text-editor', 'button', 'image', 'nav-menu', 'image-carousel', 'accordion',
    ];

    /** Widgets that must never be enabled as a generic pass-through. */
    private const BLOCKED_WIDGETS = [
        'html', 'shortcode', 'code', 'custom-css', 'custom-code', 'wordpress', 'wp-widget',
    ];

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(bool $force = false): array
    {
        $environment = Environment::snapshot();
        $signature = self::signature($environment);
        $cached = get_option(self::OPTION, []);
        if (! $force && is_array($cached) && ($cached['signature'] ?? '') === $signature) {
            $collectedAt = isset($cached['collectedAt']) ? strtotime((string) $cached['collectedAt']) : false;
            if ($collectedAt !== false && $collectedAt >= (time() - self::CACHE_TTL) && is_array($cached['snapshot'] ?? null)) {
                return $cached['snapshot'];
            }
        }

        $snapshot = self::collect($environment, $signature);
        update_option(self::OPTION, [
            'signature' => $signature,
            'collectedAt' => gmdate(DATE_ATOM),
            'snapshot' => $snapshot,
        ], false);

        return $snapshot;
    }

    public static function canWrite(string $widgetName): bool
    {
        if (self::isBlocked($widgetName)) {
            return false;
        }
        $snapshot = self::snapshot();
        $widget = $snapshot['widgets'][$widgetName] ?? null;
        return is_array($widget) && ! empty($widget['registered']) && empty($widget['blocked']);
    }

    /** @return array<int, string> */
    public static function verifiedWidgets(): array
    {
        return self::VERIFIED_WIDGETS;
    }

    /** @return array<int, string> */
    public static function blockedWidgets(): array
    {
        return self::BLOCKED_WIDGETS;
    }

    /**
     * @param array<string, mixed> $environment
     * @return array<string, mixed>
     */
    private static function collect(array $environment, string $signature): array
    {
        $widgets = [];
        $warnings = [];
        $manager = class_exists('Elementor\\Plugin') ? (\Elementor\Plugin::$instance->widgets_manager ?? null) : null;

        if (! $manager || ! method_exists($manager, 'get_widget_types')) {
            return [
                'status' => 'unavailable',
                'source' => 'Elementor\\Widgets_Manager::get_widget_types',
                'signature' => $signature,
                'collectedAt' => gmdate(DATE_ATOM),
                'registeredWidgets' => [],
                'registeredWidgetsCount' => 0,
                'verifiedWidgets' => self::VERIFIED_WIDGETS,
                'blockedWidgets' => self::BLOCKED_WIDGETS,
                'widgets' => [],
                'warnings' => ['Elementor Widgets Manager no está disponible.'],
                'environment' => $environment,
            ];
        }

        try {
            $registered = $manager->get_widget_types();
        } catch (Throwable $error) {
            return [
                'status' => 'error',
                'source' => 'Elementor\\Widgets_Manager::get_widget_types',
                'signature' => $signature,
                'collectedAt' => gmdate(DATE_ATOM),
                'registeredWidgets' => [],
                'registeredWidgetsCount' => 0,
                'verifiedWidgets' => self::VERIFIED_WIDGETS,
                'blockedWidgets' => self::BLOCKED_WIDGETS,
                'widgets' => [],
                'warnings' => ['No se pudo consultar el registro de widgets: ' . $error->getMessage()],
                'environment' => $environment,
            ];
        }

        foreach ((array) $registered as $name => $widget) {
            $name = sanitize_key((string) $name);
            if ($name === '') {
                continue;
            }
            $controlKeys = [];
            $controlTypes = [];
            $hasResponsiveControls = false;
            try {
                $stack = method_exists($widget, 'get_stack') ? $widget->get_stack(false) : [];
                $controls = is_array($stack['controls'] ?? null) ? $stack['controls'] : [];
                foreach ($controls as $controlKey => $control) {
                    $controlKey = sanitize_key((string) $controlKey);
                    if ($controlKey === '') {
                        continue;
                    }
                    $controlKeys[] = $controlKey;
                    if (is_array($control)) {
                        $type = sanitize_key((string) ($control['type'] ?? 'unknown'));
                        if ($type !== '') {
                            $controlTypes[$type] = true;
                        }
                        $hasResponsiveControls = $hasResponsiveControls || ! empty($control['responsive']);
                    }
                }
            } catch (Throwable $error) {
                $warnings[] = "No se pudieron leer los controles de {$name}: {$error->getMessage()}";
            }

            $isBlocked = self::isBlocked($name);
            $isVerified = in_array($name, self::VERIFIED_WIDGETS, true);
            $widgets[$name] = [
                'registered' => true,
                'status' => $isBlocked ? 'blocked' : ($isVerified ? 'verified' : 'native-pass-through'),
                'read' => 'verified',
                'create' => $isBlocked ? 'blocked' : 'native-pass-through',
                'update' => $isBlocked ? 'blocked' : 'native-pass-through',
                'nativeControls' => array_values(array_unique($controlKeys)),
                'controlTypes' => array_keys($controlTypes),
                'hasResponsiveControls' => $hasResponsiveControls,
            ];
        }

        ksort($widgets);
        $registeredWidgets = array_keys($widgets);
        return [
            'status' => 'verified',
            'source' => 'Elementor\\Widgets_Manager::get_widget_types',
            'signature' => $signature,
            'collectedAt' => gmdate(DATE_ATOM),
            'registeredWidgets' => $registeredWidgets,
            'registeredWidgetsCount' => count($registeredWidgets),
            'verifiedWidgets' => self::VERIFIED_WIDGETS,
            'blockedWidgets' => self::BLOCKED_WIDGETS,
            'widgets' => $widgets,
            'warnings' => array_values(array_unique($warnings)),
            'environment' => $environment,
        ];
    }

    /** @param array<string, mixed> $environment */
    private static function signature(array $environment): string
    {
        $signature = [
            'wordpress' => $environment['wordpress'] ?? [],
            'php' => $environment['php'] ?? [],
            'elementor' => $environment['elementor'] ?? [],
            'elementorPro' => $environment['elementorPro'] ?? [],
            'theme' => $environment['theme'] ?? [],
            'features' => $environment['features'] ?? [],
            'plugins' => $environment['plugins'] ?? [],
        ];
        return 'sha256:' . hash('sha256', (string) wp_json_encode($signature));
    }

    private static function isBlocked(string $widgetName): bool
    {
        if (in_array($widgetName, self::BLOCKED_WIDGETS, true)) {
            return true;
        }

        return (bool) preg_match('/(^|[-_])(html|shortcode|code|script|php|raw)([-_]|$)/i', $widgetName);
    }
}
