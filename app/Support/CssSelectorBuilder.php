<?php

namespace App\Support;

class CssSelectorBuilder
{
    /**
     * @param  array{tag?: string|null, id?: string|null, class?: string|null, name?: string|null, type?: string|null}  $parts
     */
    public static function build(array $parts): ?string
    {
        $tag = self::normalizeTag($parts['tag'] ?? null);
        $id = self::normalizeId($parts['id'] ?? null);
        $class = self::normalizeClassList($parts['class'] ?? null);
        $name = self::normalizeName($parts['name'] ?? null);
        $type = self::normalizeType($parts['type'] ?? null);

        if ($id === null && $class === null && $tag === null && $name === null && $type === null) {
            return null;
        }

        $selector = '';

        if ($id !== null) {
            $selector = '#'.$id;
        } else {
            $selector = $tag ?? '*';
            if ($class !== null) {
                foreach (preg_split('/\s+/', $class) ?: [] as $piece) {
                    if ($piece !== '') {
                        $selector .= '.'.ltrim($piece, '.');
                    }
                }
            }

            if ($name !== null) {
                $selector .= '[name="'.$name.'"]';
            }
            if ($type !== null) {
                $selector .= '[type="'.$type.'"]';
            }
        }

        return $selector !== '' ? $selector : null;
    }

    public static function scoped(?string $scope, ?string $selector): ?string
    {
        if (blank($selector)) {
            return null;
        }

        if (blank($scope)) {
            return $selector;
        }

        return trim($scope).' '.trim($selector);
    }

    /**
     * @return array{tag: ?string, id: ?string, class: ?string, name: ?string, type: ?string}
     */
    public static function parse(?string $selector): array
    {
        if (blank($selector)) {
            return ['tag' => null, 'id' => null, 'class' => null, 'name' => null, 'type' => null];
        }

        $selector = trim($selector);

        if (preg_match('/#([a-zA-Z0-9_-]+)/', $selector, $matches)) {
            return ['tag' => null, 'id' => $matches[1], 'class' => null, 'name' => null, 'type' => null];
        }

        $tag = null;
        $classParts = [];
        $name = null;
        $type = null;

        if (preg_match('/^([a-zA-Z][a-zA-Z0-9-]*)/', $selector, $matches)) {
            $tag = strtolower($matches[1]);
        }

        if (preg_match_all('/\.([a-zA-Z0-9_-]+)/', $selector, $matches)) {
            $classParts = $matches[1];
        }

        if (preg_match('/\[name=(?:"|\')?([^"\']+)(?:"|\')?\]/', $selector, $matches)) {
            $name = $matches[1];
        }
        if (preg_match('/\[type=(?:"|\')?([^"\']+)(?:"|\')?\]/', $selector, $matches)) {
            $type = $matches[1];
        }

        return [
            'tag' => $tag,
            'id' => null,
            'class' => $classParts !== [] ? implode(' ', $classParts) : null,
            'name' => $name,
            'type' => $type,
        ];
    }

    private static function normalizeTag(?string $tag): ?string
    {
        $tag = strtolower(trim((string) $tag));

        return $tag !== '' ? $tag : null;
    }

    private static function normalizeId(?string $id): ?string
    {
        $id = trim((string) $id);
        $id = ltrim($id, '#');

        return $id !== '' ? $id : null;
    }

    private static function normalizeClassList(?string $class): ?string
    {
        $class = trim((string) $class);
        $class = str_replace(',', ' ', $class);
        $pieces = preg_split('/\s+/', $class) ?: [];
        $pieces = array_values(array_filter(array_map(
            static fn (string $piece): string => ltrim($piece, '.'),
            $pieces,
        )));

        return $pieces !== [] ? implode(' ', $pieces) : null;
    }

    private static function normalizeName(?string $name): ?string
    {
        $name = trim((string) $name);

        return $name !== '' ? $name : null;
    }

    private static function normalizeType(?string $type): ?string
    {
        $type = strtolower(trim((string) $type));

        return $type !== '' ? $type : null;
    }
}
