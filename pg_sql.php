<?php
// Harden session cookie handling before starting the session
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Lax',
]);

session_start();
header('Content-Type: application/json');

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function require_post(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['error' => 'Only POST requests are allowed.'], 405);
    }
}

function get_connections(): array
{
    return $_SESSION['pg_sql_connections'] ?? [];
}

function set_connections(array $connections): void
{
    $_SESSION['pg_sql_connections'] = $connections;
}

function set_active_connection(?string $connectionId): void
{
    $_SESSION['pg_sql_active'] = $connectionId;
}

function get_active_connection(): ?string
{
    $active = $_SESSION['pg_sql_active'] ?? null;
    if ($active && !isset(get_connections()[$active])) {
        return null;
    }

    return $active;
}

require_post();

$rawInput = file_get_contents('php://input');
if ($rawInput === false) {
    respond(['error' => 'Unable to read request body'], 400);
}

$data = json_decode($rawInput, true);
if (!is_array($data)) {
    respond(['error' => 'Invalid JSON payload'], 400);
}

$action = $data['action'] ?? null;

function buildDsn(array $credentials): string
{
    $host = trim((string)($credentials['host'] ?? ''));
    $database = trim((string)($credentials['database'] ?? ''));
    $port = $credentials['port'] ?? null;
    $portPart = $port !== null && $port !== '' ? ";port=" . ((int)$port) : '';

    return "pgsql:host={$host}{$portPart};dbname={$database}";
}

function validateCredentials(?array $credentials): array
{
    if (!$credentials || !isset($credentials['host'], $credentials['user'], $credentials['password'], $credentials['database'])) {
        respond(['error' => 'Invalid credentials'], 400);
    }

    return [
        'id' => $credentials['id'] ?? 'default',
        'host' => trim((string)$credentials['host']),
        'port' => $credentials['port'] ?? null,
        'user' => trim((string)$credentials['user']),
        'password' => (string)$credentials['password'],
        'database' => trim((string)$credentials['database']),
    ];
}

function createPdo(array $credentials): PDO
{
    $dsn = buildDsn($credentials);

    return new PDO($dsn, $credentials['user'], $credentials['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

if ($action === 'login') {
    $credentials = validateCredentials($data['credentials'] ?? null);
    $connections = get_connections();

    try {
        // Validate connection before storing in the session
        createPdo($credentials);

        $connections[$credentials['id']] = $credentials;
        set_connections($connections);

        if (($data['set_active'] ?? true) || !get_active_connection()) {
            set_active_connection($credentials['id']);
        }

        respond([
            'success' => true,
            'connection_id' => $credentials['id'],
            'active_connection' => get_active_connection(),
            'available_connections' => array_keys(get_connections()),
        ]);
    } catch (Throwable $e) {
        respond(['error' => $e->getMessage()], 400);
    }
}

if ($action === 'disconnect') {
    $connectionId = $data['connection_id'] ?? null;
    $connections = get_connections();

    if (!$connectionId || !isset($connections[$connectionId])) {
        respond(['error' => 'Connection ID not found'], 404);
    }

    unset($connections[$connectionId]);
    set_connections($connections);

    if (get_active_connection() === $connectionId) {
        set_active_connection($connections ? array_key_first($connections) : null);
    }

    respond([
        'success' => true,
        'active_connection' => get_active_connection(),
        'available_connections' => array_keys(get_connections()),
    ]);
}

if ($action === 'status') {
    respond([
        'connected' => (bool)get_connections(),
        'active_connection' => get_active_connection(),
        'available_connections' => array_keys(get_connections()),
    ]);
}

if ($action === 'set_active') {
    $connectionId = $data['connection_id'] ?? null;
    $connections = get_connections();

    if (!$connectionId || !isset($connections[$connectionId])) {
        respond(['error' => 'Connection ID not found'], 404);
    }

    set_active_connection($connectionId);

    respond([
        'success' => true,
        'active_connection' => $connectionId,
        'available_connections' => array_keys($connections),
    ]);
}

$connections = get_connections();

if (!$connections) {
    respond(['error' => 'No active connection'], 401);
}

$connectionId = $data['connection_id'] ?? get_active_connection();

if (!$connectionId || !isset($connections[$connectionId])) {
    respond(['error' => 'Connection ID not found'], 404);
}

$credentials = $connections[$connectionId];

try {
    $pdo = createPdo($credentials);
    $query = $data['query'] ?? null;
    $params = $data['params'] ?? [];

    if (!$query) {
        respond(['error' => 'No query provided'], 400);
    }

    $stmt = $pdo->prepare($query);
    $stmt->execute(is_array($params) ? $params : []);
    $result = $stmt->fetchAll(PDO::FETCH_ASSOC);

    respond([
        'success' => true,
        'rows' => $result,
        'active_connection' => get_active_connection(),
        'used_connection' => $connectionId,
        'available_connections' => array_keys($connections),
    ]);
} catch (Throwable $e) {
    respond(['error' => $e->getMessage()], 400);
}
