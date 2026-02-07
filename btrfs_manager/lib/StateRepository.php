<?php

declare(strict_types=1);

final class StateRepository
{
    private string $path;
    private array $state;

    public function __construct(string $path)
    {
        $this->path = $path;
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException('Unable to read state file.');
        }

        $decoded = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded)) {
            throw new RuntimeException('State file format invalid.');
        }

        $this->state = $decoded;
    }

    public function pools(): array
    {
        return $this->state['pools'] ?? [];
    }

    public function devices(): array
    {
        return $this->state['devices'] ?? [];
    }

    public function snapshots(): array
    {
        return $this->state['snapshots'] ?? [];
    }

    public function operations(): array
    {
        return $this->state['operations'] ?? [];
    }
}
