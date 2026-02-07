<?php

declare(strict_types=1);

final class CommandRunner
{
    private array $allowedCommands;

    public function __construct(array $allowedCommands)
    {
        $this->allowedCommands = $allowedCommands;
    }

    public function isAllowed(string $command): bool
    {
        $base = $this->extractBinary($command);
        return in_array($base, $this->allowedCommands, true);
    }

    public function run(string $command, bool $dryRun = false): array
    {
        if (!$this->isAllowed($command)) {
            return [
                'ok' => false,
                'error' => 'Command not allowed.',
                'command' => $command,
                'dry_run' => $dryRun,
            ];
        }

        if ($dryRun) {
            return [
                'ok' => true,
                'output' => [],
                'command' => $command,
                'dry_run' => true,
            ];
        }

        $output = [];
        $exitCode = 0;
        exec('sudo ' . $command . ' 2>&1', $output, $exitCode);

        return [
            'ok' => $exitCode === 0,
            'output' => $output,
            'exit_code' => $exitCode,
            'command' => $command,
            'dry_run' => false,
        ];
    }

    private function extractBinary(string $command): string
    {
        $parts = preg_split('/\s+/', trim($command));
        if (!$parts) {
            return '';
        }

        return $parts[0];
    }
}
