<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Support;

final class AuditLog
{
    public function record(string $action, int $documentId = 0, array $context = []): void
    {
        $entries = (array) get_option('escarlet_eb_audit_log', []);
        array_unshift($entries, [
            'action' => sanitize_key($action),
            'documentId' => $documentId,
            'userId' => get_current_user_id(),
            'createdAt' => current_time(DATE_ATOM),
            'context' => $this->redact($context),
        ]);
        update_option('escarlet_eb_audit_log', array_slice($entries, 0, 100), false);
    }

    /** @return array<int, array<string, mixed>> */
    public function recent(int $limit = 20): array
    {
        return array_slice((array) get_option('escarlet_eb_audit_log', []), 0, max(1, min(100, $limit)));
    }

    private function redact(array $value): array
    {
        foreach ($value as $key => $item) {
            if (preg_match('/password|secret|token|authorization|cookie/i', (string) $key)) {
                $value[$key] = '[REDACTED]';
            } elseif (is_array($item)) {
                $value[$key] = $this->redact($item);
            }
        }
        return $value;
    }
}

