<?php

declare(strict_types=1);

namespace Escarlet\ElementorBridge\Schema;

final class CanonicalJson
{
    public function encode(mixed $value): string
    {
        return (string) wp_json_encode($this->normalize($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }

    public function hash(mixed $value): string
    {
        return 'sha256:' . hash('sha256', $this->encode($value));
    }

    private function normalize(mixed $value): mixed
    {
        if (is_array($value)) {
            if (array_is_list($value)) {
                return array_map(fn (mixed $item): mixed => $this->normalize($item), $value);
            }

            ksort($value);
            foreach ($value as $key => $item) {
                $value[$key] = $this->normalize($item);
            }
        }

        return $value;
    }
}

