<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Elementor;

final class NodeConverter
{
    public function __construct(private readonly NodeIdentity $identity)
    {
    }

    /** @param array<int, array<string, mixed>> $elements */
    public function toSchema(int $postId, array $elements, string $parentPath = ''): array
    {
        return array_map(
            fn (array $element, mixed $index): array => $this->readNode(
                $postId,
                $element,
                $parentPath === '' ? (string) $index : $parentPath . '.' . (string) $index,
            ),
            $elements,
            array_keys($elements),
        );
    }

    /** @param array<int, array<string, mixed>> $nodes */
    public function toElementor(int $postId, array $nodes, string $parentPath = ''): array
    {
        return array_map(
            fn (array $node, mixed $index): array => $this->writeNode(
                $postId,
                $node,
                $parentPath === '' ? (string) $index : $parentPath . '.' . (string) $index,
            ),
            $nodes,
            array_keys($nodes),
        );
    }

    /** @param array<string, mixed> $element */
    private function readNode(int $postId, array $element, string $path): array
    {
        // Elementor document data uses `id` for element IDs. `_id` is used by
        // repeater items, not by document elements, but accept it for legacy
        // data created by earlier bridge builds.
        $internalId = isset($element['id'])
            ? (string) $element['id']
            : (isset($element['_id']) ? (string) $element['_id'] : $this->identity->newInternalId());
        $elType = (string) ($element['elType'] ?? 'container');
        $settings = is_array($element['settings'] ?? null) ? $element['settings'] : [];
        $embeddedExternalId = isset($settings['_escarlet_external_id']) ? sanitize_key((string) $settings['_escarlet_external_id']) : '';
        $externalId = $embeddedExternalId !== '' ? $embeddedExternalId : $this->identity->externalFor($postId, $internalId, $path);
        $preservedSettings = $settings;
        unset($preservedSettings['_escarlet_external_id']);
        $children = is_array($element['elements'] ?? null) ? $element['elements'] : [];
        $rawWidgetType = $elType === 'widget' ? sanitize_key((string) ($element['widgetType'] ?? '')) : '';
        $widget = $elType === 'widget' ? $this->widgetFromElementor($rawWidgetType) : null;
        $this->identity->remember($postId, $externalId, $internalId, $path);

        $node = [
            'id' => $externalId,
            'type' => $elType === 'widget' ? 'widget' : 'container',
            'settings' => $this->settingsFromElementor($widget, $preservedSettings, is_array($element['styles'] ?? null) ? $element['styles'] : []),
            'children' => $elType === 'widget' ? [] : $this->toSchema($postId, $children, $path),
            'extensions' => [
                'rawPreservedSettings' => $preservedSettings,
                'escarlet' => [
                    'externalId' => $externalId,
                ],
                // The bridge keeps the installed widget type as adapter metadata;
                // the neutral `widget` field remains the portable contract.
                'elementor' => [
                    'elType' => $elType,
                    'isInner' => ! empty($element['isInner']),
                    'isLocked' => ! empty($element['isLocked']),
                ],
            ],
        ];
        if ($widget !== null) {
            $node['widget'] = $widget;
        }
        if ($elType === 'widget') {
            $node['extensions']['elementor']['widgetType'] = $rawWidgetType;
        }
        if (isset($element['settings']['_css_classes'])) {
            $node['semanticRole'] = sanitize_key((string) $element['settings']['_css_classes']);
        }

        return $node;
    }

    /** @param array<string, mixed> $node */
    private function writeNode(int $postId, array $node, string $path): array
    {
        $externalId = (string) $node['id'];
        $extensions = is_array($node['extensions'] ?? null) ? $node['extensions'] : [];
        $elementorExtension = is_array($extensions['elementor'] ?? null) ? $extensions['elementor'] : [];
        $internalId = isset($elementorExtension['internalId'])
            ? (string) $elementorExtension['internalId']
            : $this->identity->resolveInternal($postId, $externalId, $path);
        if ($internalId === $externalId || $internalId === '') {
            $internalId = $this->identity->newInternalId();
        }
        $this->identity->remember($postId, $externalId, $internalId, $path);

        $rawSettings = is_array($extensions['rawPreservedSettings'] ?? null) ? $extensions['rawPreservedSettings'] : [];
        $settings = array_replace($rawSettings, is_array($node['settings'] ?? null) ? $this->settingsToElementor((string) ($node['widget'] ?? ''), $node['settings']) : []);
        // Elementor preserves unknown settings in the document data. This controlled
        // marker makes the neutral node ID stable even if the private map is lost
        // during a document save or migration.
        $settings['_escarlet_external_id'] = $externalId;
        if (isset($node['semanticRole']) && is_string($node['semanticRole'])) {
            $settings['_css_classes'] = sanitize_html_class($node['semanticRole']);
        }

        // Elementor's document element contract uses `id`, `elType`,
        // `settings`, `elements`, and `isInner`. Do not use `_id` here: that
        // key belongs to repeater items and can leave the visual editor unable
        // to build its document model.
        $result = [
            'id' => $internalId,
            'elType' => $node['type'] === 'widget' ? 'widget' : 'container',
            'settings' => $settings,
            'isInner' => ! empty($elementorExtension['isInner']),
        ];
        if (! empty($elementorExtension['isLocked'])) {
            $result['isLocked'] = true;
        }
        if ($node['type'] === 'widget') {
            $rawWidgetType = isset($elementorExtension['widgetType'])
                ? sanitize_key((string) $elementorExtension['widgetType'])
                : '';
            $result['widgetType'] = $rawWidgetType !== ''
                ? $rawWidgetType
                : $this->widgetToElementor((string) ($node['widget'] ?? ''));
        } else {
            $result['elements'] = $this->toElementor($postId, is_array($node['children'] ?? null) ? $node['children'] : [], $path);
        }

        return $result;
    }

    private function widgetFromElementor(string $widget): ?string
    {
        return match ($widget) {
            'heading', 'e-heading' => 'heading',
            'text-editor', 'e-paragraph' => 'text-editor',
            'button', 'e-button' => 'button',
            'image', 'e-image' => 'image',
            'nav-menu' => 'nav-menu',
            'image-carousel' => 'image-carousel',
            'accordion' => 'accordion',
            default => $widget !== '' ? $widget : null,
        };
    }

    private function widgetToElementor(string $widget): string
    {
        return match ($widget) {
            'heading' => 'heading',
            'text-editor' => 'text-editor',
            'button' => 'button',
            'image' => 'image',
            default => sanitize_key($widget),
        };
    }

    private function settingsFromElementor(?string $widget, array $settings, array $styles = []): array
    {
        $settings = array_replace($this->settingsFromStyles($styles, $widget), $settings);
        return match ($widget) {
            'heading' => array_replace($settings, [
                'title' => isset($settings['title']) ? $this->textValue($settings['title']) : '',
                'htmlTag' => isset($settings['header_size']) ? sanitize_key($this->textValue($settings['header_size'])) : (isset($settings['tag']) ? sanitize_key($this->textValue($settings['tag'])) : 'h2'),
            ]),
            'text-editor' => array_replace($settings, [
                'content' => isset($settings['editor']) ? wp_kses_post((string) $settings['editor']) : '',
            ]),
            'button' => array_replace($settings, [
                'text' => isset($settings['text']) ? $this->textValue($settings['text']) : '',
                'url' => isset($settings['link']) ? esc_url_raw($this->urlValue($settings['link'])) : '',
            ]),
            'image' => array_replace($settings, [
                'mediaId' => isset($settings['image']) ? $this->imageId($settings['image']) : 0,
            ]),
            default => $settings,
        };
    }

    /** @param array<string, mixed> $styles @return array<string, mixed> */
    private function settingsFromStyles(array $styles, ?string $widget): array
    {
        $props = [];
        foreach ($styles as $style) {
            if (! is_array($style) || ! is_array($style['variants'] ?? null)) {
                continue;
            }
            $variant = $style['variants'][0] ?? [];
            if (is_array($variant) && is_array($variant['props'] ?? null)) {
                $props = array_replace($props, $variant['props']);
            }
        }
        if ($props === []) {
            return [];
        }

        $result = [];
        foreach ($props as $property => $value) {
            $property = (string) $property;
            $unwrapped = $this->unwrap($value);
            switch ($property) {
                case 'height':
                    $size = $this->sizeValue($unwrapped);
                    if ($size !== null) {
                        $result['min_height'] = $size;
                    }
                    break;
                case 'padding':
                    $size = $this->sizeValue($unwrapped);
                    if ($size !== null) {
                        $result['padding'] = [
                            'unit' => $size['unit'], 'top' => $size['size'], 'right' => $size['size'],
                            'bottom' => $size['size'], 'left' => $size['size'], 'isLinked' => true,
                        ];
                    }
                    break;
                case 'flex-direction': $result['flex_direction'] = $this->textValue($unwrapped); break;
                case 'justify-content': $result['justify_content'] = $this->textValue($unwrapped); break;
                case 'align-items': $result['align_items'] = $this->textValue($unwrapped); break;
                case 'text-align': $result['align'] = $this->textValue($unwrapped); break;
                case 'font-size':
                    $size = $this->sizeValue($unwrapped);
                    if ($size !== null) $result['typography_font_size'] = $size;
                    break;
                case 'color':
                    $result[$widget === 'text-editor' ? 'text_color' : 'title_color'] = $this->textValue($unwrapped);
                    break;
                case 'border-radius':
                    $size = $this->sizeValue($unwrapped);
                    if ($size !== null) $result['border_radius'] = $size;
                    break;
                case 'border-width':
                    $size = $this->sizeValue($unwrapped);
                    if ($size !== null) $result['border_width'] = $size;
                    break;
                case 'border-color': $result['border_color'] = $this->textValue($unwrapped); break;
                case 'background':
                    $this->backgroundSettings($result, $unwrapped);
                    break;
            }
        }

        return $result;
    }

    /** @param array<string, mixed> $result */
    private function backgroundSettings(array &$result, mixed $background): void
    {
        if (! is_array($background)) {
            return;
        }
        $backgroundColor = $this->textValue($this->unwrap($background['color'] ?? null));
        if ($backgroundColor !== '') {
            $result['background_color'] = $backgroundColor;
            $result['background_background'] = 'classic';
        }
        $overlays = $this->unwrap($background['background-overlay'] ?? null);
        if (! is_array($overlays)) {
            return;
        }
        foreach ($overlays as $overlayWrapper) {
            if (! is_array($overlayWrapper)) continue;
            $overlayType = (string) ($overlayWrapper['$$type'] ?? '');
            $overlay = $this->unwrap($overlayWrapper);
            if (! is_array($overlay)) continue;
            if (str_contains($overlayType, 'color')) {
                [$color, $opacity] = $this->colorAndOpacity($this->textValue($this->unwrap($overlay['color'] ?? null)));
                if ($color !== '') {
                    $result['background_overlay_background'] = 'classic';
                    $result['background_overlay_color'] = $color;
                    if ($opacity !== null) $result['background_overlay_opacity'] = $opacity;
                }
            }
            if (str_contains($overlayType, 'image')) {
                $image = $this->unwrap($overlay['image'] ?? null);
                $source = is_array($image) ? $this->unwrap($image['src'] ?? null) : null;
                $id = is_array($source) ? absint($this->unwrap($source['id'] ?? null)) : 0;
                if ($id) {
                    $result['background_background'] = 'classic';
                    $result['background_image'] = ['id' => $id, 'url' => '', 'size' => 'large'];
                }
                $size = $this->textValue($this->unwrap($overlay['size'] ?? null));
                $position = $this->textValue($this->unwrap($overlay['position'] ?? null));
                if ($size !== '') $result['background_size'] = $size;
                if ($position !== '') $result['background_position'] = $position;
            }
        }
    }

    /** @return array{0: string, 1: float|null} */
    private function colorAndOpacity(string $color): array
    {
        if (preg_match('/^#([0-9a-f]{8})$/i', $color, $matches)) {
            return ['#' . substr($matches[1], 0, 6), round(hexdec(substr($matches[1], 6, 2)) / 255, 3)];
        }
        return [$color, null];
    }

    private function unwrap(mixed $value): mixed
    {
        while (is_array($value) && array_key_exists('value', $value)) {
            $value = $value['value'];
        }
        return $value;
    }

    private function textValue(mixed $value): string
    {
        $value = $this->unwrap($value);
        if (is_string($value) || is_numeric($value)) return wp_strip_all_tags((string) $value);
        if (! is_array($value)) return '';
        if (array_key_exists('content', $value)) return $this->textValue($value['content']);
        if (array_key_exists('destination', $value)) return $this->textValue($value['destination']);
        return '';
    }

    private function urlValue(mixed $value): string
    {
        $value = $this->unwrap($value);
        if (! is_array($value)) return $this->textValue($value);
        if (array_key_exists('destination', $value)) return $this->urlValue($value['destination']);
        if (array_key_exists('url', $value)) return $this->urlValue($value['url']);
        return '';
    }

    private function imageId(mixed $value): int
    {
        $value = $this->unwrap($value);
        if (! is_array($value)) return absint($value);
        if (isset($value['src'])) return $this->imageId($value['src']);
        if (isset($value['id'])) return absint($this->unwrap($value['id']));
        return 0;
    }

    /** @return array{unit: string, size: int|float|string}|null */
    private function sizeValue(mixed $value): ?array
    {
        $value = $this->unwrap($value);
        if (! is_array($value) || ! array_key_exists('size', $value)) return null;
        return ['unit' => (string) ($value['unit'] ?? 'px'), 'size' => $value['size']];
    }

    private function settingsToElementor(string $widget, array $settings): array
    {
        $result = $settings;
        if ($widget === 'heading') {
            if (isset($settings['title'])) {
                $result['title'] = wp_strip_all_tags((string) $settings['title']);
            }
            if (isset($settings['htmlTag'])) {
                $result['header_size'] = sanitize_key((string) $settings['htmlTag']);
                unset($result['htmlTag']);
            }
        } elseif ($widget === 'text-editor') {
            if (isset($settings['content'])) {
                $result['editor'] = wp_kses_post((string) $settings['content']);
                unset($result['content']);
            }
        } elseif ($widget === 'button') {
            if (isset($settings['text'])) {
                $result['text'] = wp_strip_all_tags((string) $settings['text']);
            }
            if (isset($settings['url'])) {
                $result['link'] = ['url' => esc_url_raw((string) $settings['url'])];
                unset($result['url']);
            }
        } elseif ($widget === 'image' && isset($settings['mediaId'])) {
            $mediaId = absint($settings['mediaId']);
            $result['image'] = ['id' => $mediaId, 'url' => $mediaId ? (string) wp_get_attachment_url($mediaId) : ''];
            unset($result['mediaId']);
        }

        return $result;
    }
}
