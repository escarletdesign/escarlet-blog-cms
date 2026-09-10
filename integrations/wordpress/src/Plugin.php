<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge;

use Escarlet\ElementorBridge\Admin\AdminPage;
use Escarlet\ElementorBridge\Api\RestController;
use Escarlet\ElementorBridge\Elementor\CapabilityRegistry;
use Escarlet\ElementorBridge\Elementor\ElementorAdapter;
use Escarlet\ElementorBridge\Elementor\ThemeBuilderRepository;
use Escarlet\ElementorBridge\Revisions\CheckpointRepository;
use Escarlet\ElementorBridge\Schema\CanonicalJson;
use Escarlet\ElementorBridge\Schema\SchemaValidator;
use Escarlet\ElementorBridge\WordPress\DocumentRepository;

final class Plugin
{
    private static ?self $instance = null;

    private function __construct(
        private readonly ElementorAdapter $elementor,
        private readonly DocumentRepository $documents,
        private readonly ThemeBuilderRepository $themeBuilder,
        private readonly CheckpointRepository $checkpoints,
    ) {
    }

    public static function boot(): void
    {
        if (self::$instance instanceof self) {
            return;
        }

        $elementor = new ElementorAdapter();
        $checkpoints = new CheckpointRepository();
        $validator = new SchemaValidator(static fn (string $widget): bool => $elementor->canWriteWidget($widget));
        $canonical = new CanonicalJson();
        $documents = new DocumentRepository($elementor, $checkpoints, $validator, $canonical);
        $themeBuilder = new ThemeBuilderRepository($elementor, $checkpoints, $validator, $canonical);
        self::$instance = new self($elementor, $documents, $themeBuilder, $checkpoints);

        // Elementor and its addons finish registering widgets during init. The
        // first init pass creates the private snapshot without blocking plugin
        // activation; capabilities requests can force a refresh later.
        add_action('init', static function (): void {
            CapabilityRegistry::snapshot();
        }, 30);
        add_action('init', [CheckpointRepository::class, 'register_post_type']);
        (new RestController($documents, $elementor, $themeBuilder, $checkpoints))->register();
        (new AdminPage($elementor, $checkpoints))->register();
    }

    public static function instance(): self
    {
        if (! self::$instance instanceof self) {
            self::boot();
        }

        return self::$instance;
    }

    public function elementor(): ElementorAdapter
    {
        return $this->elementor;
    }

    public function documents(): DocumentRepository
    {
        return $this->documents;
    }

    public function checkpoints(): CheckpointRepository
    {
        return $this->checkpoints;
    }

    public function themeBuilder(): ThemeBuilderRepository
    {
        return $this->themeBuilder;
    }
}
