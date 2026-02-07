<?php

declare(strict_types=1);

require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/Response.php';
require_once __DIR__ . '/../lib/CommandRunner.php';
require_once __DIR__ . '/../lib/StateRepository.php';

$action = $_GET['action'] ?? '';

try {
    $config = new Config(__DIR__ . '/../config/manager.json');
    $state = new StateRepository(__DIR__ . '/../data/sample_state.json');
} catch (RuntimeException $exception) {
    Response::json([
        'ok' => false,
        'error' => $exception->getMessage(),
    ], 500);
    exit;
}

switch ($action) {
    case 'meta':
        Response::json([
            'ok' => true,
            'data' => [
                'app' => $config->get('app', []),
                'security' => $config->get('security', []),
            ],
        ]);
        break;

    case 'hosts':
        Response::json([
            'ok' => true,
            'data' => $config->get('hosts', []),
        ]);
        break;

    case 'pools':
        Response::json([
            'ok' => true,
            'data' => $state->pools(),
        ]);
        break;

    case 'devices':
        Response::json([
            'ok' => true,
            'data' => $state->devices(),
        ]);
        break;

    case 'snapshots':
        Response::json([
            'ok' => true,
            'data' => [
                'policies' => $config->get('snapshot_policies', []),
                'snapshots' => $state->snapshots(),
            ],
        ]);
        break;

    case 'zenbox':
        Response::json([
            'ok' => true,
            'data' => [
                'config' => $config->get('zenbox', []),
                'instances' => [],
            ],
        ]);
        break;

    case 'operations':
        Response::json([
            'ok' => true,
            'data' => $state->operations(),
        ]);
        break;

    case 'command':
        $command = $_POST['command'] ?? '';
        $dryRun = filter_var($_POST['dry_run'] ?? 'false', FILTER_VALIDATE_BOOLEAN);
        $allowed = $config->get('security', []);
        $runner = new CommandRunner($allowed['allowed_commands'] ?? []);
        $result = $runner->run((string) $command, $dryRun);
        $status = $result['ok'] ? 200 : 400;
        Response::json($result, $status);
        break;

    default:
        Response::json([
            'ok' => false,
            'error' => 'Unknown action.',
            'available' => ['meta', 'hosts', 'pools', 'devices', 'snapshots', 'operations', 'zenbox', 'command'],
        ], 404);
}
