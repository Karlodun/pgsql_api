<?php
declare(strict_types=1);

session_set_cookie_params([
    'httponly' => true,
    'secure' => true,
    'samesite' => 'Strict',
]);

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/pgsql_config.php';

// Event layer settings (optional, see docs/EVENTS.md). Old configs without them keep working.
$pgsql_events = ($pgsql_events ?? []) + [
    'secret' => getenv('PGSQL_EVENT_SECRET') ?: null, // shared HMAC secret with notifyd
    'ttl'    => 300,                                  // token lifetime, seconds
];

$_SESSION['connections'] ??= [];
$_SESSION['default_connection'] ??= null;

function j($x): void {
    echo json_encode($x, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $http = 400, array $extra = []): void {
    http_response_code($http);
    j(['error' => $msg] + $extra);
}

function b64url(string $s): string {
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function random_conn_id(int $len = 4, int $tries = 10): string {
    // Human-friendly, URL-safe alphabet (no 0/O, no I/l/1)
    $alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz_';
    $max = strlen($alphabet) - 1;

    for ($t = 0; $t < $tries; $t++) {
        $bytes = random_bytes($len);
        $id = '';

        for ($i = 0; $i < $len; $i++) {
            $id .= $alphabet[ord($bytes[$i]) % ($max + 1)];
        }

        if (!isset($_SESSION['connections'][$id])) {
            return $id;
        }
    }

    // If we are here — something is seriously wrong
    j([
        'error' => 'Unable to generate unique connection id after '
            . $tries . ' attempts. Increase id length or check session state.'
    ]);
}

function pg_connection(array $connection, array $profile): mixed
{
    $p = array_merge($connection, $profile);

    $keys = ['service','host','hostaddr','port','dbname','user','password','sslmode','connect_timeout','options','application_name'];

    $parts = [];
    foreach ($keys as $k) {
        if (!isset($p[$k]) || $p[$k] === '') continue;
        $v = (string)$p[$k];
        if (preg_match('/[\s\'\\\\]/', $v)) $v = "'" . str_replace(["\\","'"], ["\\\\","\\'"], $v) . "'";
        $parts[] = $k . '=' . $v;
    }

    if (!$pg = @pg_connect(implode(' ', $parts), PGSQL_CONNECT_FORCE_NEW)) j(['error' => 'Could not connect to database', 'details' => pg_last_error() ?: 'pg_connect() failed']);
    return $pg;
}

function pg_fail($pg, string $fallback): void {
    $e = pg_last_error($pg) ?: $fallback;
    @pg_close($pg);
    j(['error' => $e]);
}

// CSRF: only JSON bodies are accepted. A cross-site page cannot send
// Content-Type: application/json without a CORS preflight, which this script never approves.
$ctype = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
if ($ctype !== 'application/json') fail('Content-Type must be application/json', 415);

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) fail('Request body must be a JSON object');
$action = $in['action'] ?? null;

if (!$action) j(['error' => 'Missing action']);

if ('get_profiles' === $action) {
    session_write_close();
    $out = [];
    foreach ($pgsql_profiles as $profile_id => $p) {
        $out[$profile_id] = [
            'name' => $p['name'] ?? $profile_id,
            'class' => $p['class'] ?? null,
            'description' => $p['description'] ?? null,
        ];
    }
    j(['data' => $out]);
}

if ('connect' === $action) {
    if (!isset($in['profile_id']) || !is_string($in['profile_id'])) fail('Missing profile_id');
    $in['conn_id'] ??= random_conn_id(4);
    $c = $in['credentials'] ?? [];
    if (!is_array($c)) fail('credentials must be an object');
    // limiting app_name to 64 chars:
    if (isset($c['application_name'])) $c['application_name'] = substr((string)$c['application_name'], 0, 64);

    $p = $pgsql_profiles[$in['profile_id']] ?? null;
    if (!is_array($p)) j(['error' => 'Unknown profile_id: ' . $in['profile_id']]);

    $pg = pg_connection($c, $p);

    if (!$res_dbrole = @pg_query($pg, "select session_user, current_role")) pg_fail($pg, 'Could not obtain session and current user');

    $val_dbrole = pg_fetch_assoc($res_dbrole) ?: []; pg_free_result($res_dbrole);

    // first successful login in this session: new session id (session fixation)
    if (!$_SESSION['connections']) session_regenerate_id(true);

    $_SESSION['connections'][$in['conn_id']] = array_merge(
        $c,
        ['profile_id'   => $in['profile_id']],
        $val_dbrole
        );

    $_SESSION['default_connection'] ??= $in['conn_id'];
    session_write_close();

    @pg_close($pg);

    j([ 'data' => array_merge( ['conn_id' => $in['conn_id']], $val_dbrole ) ]);
}


// all following actions can only happen if we have a valid connection. we pick a connection id:
$conn_id = $in['conn_id'] ?? $_SESSION['default_connection'];
// handling missing or broken connections:
if (!isset($_SESSION['connections'][$conn_id])) j(['error' => 'Connection not found: ' . $conn_id]);

$c = $_SESSION['connections'][$conn_id]; //connection
$p = $pgsql_profiles[$c['profile_id']] ?? null; //profile
if (!is_array($p)) j(['error' => 'Unknown profile_id: ' . ($c['profile_id'] ?? '')]);

// Only set_role writes to the session. Everything else releases the session lock now,
// so independent requests of one browser run in parallel.
if ('set_role' !== $action) session_write_close();

$pg = pg_connection($c, $p);

// if needed we can supply different current role to act from.
// PostgreSQL decides whether the switch is allowed; it is checked right now and only then stored.
if ('set_role' === $action) {
    if (!array_key_exists('role', $in)) fail('Missing role');
    $role = $in['role'] ?? $c['session_user']; // null = back to the login role
    if (!@pg_query($pg, 'SET ROLE ' . pg_escape_identifier($pg, (string)$role))) pg_fail($pg, 'SET ROLE failed');
    $_SESSION['connections'][$conn_id]['current_role'] = (string)$role;
    session_write_close();
    @pg_close($pg);
    j(['data' => ['current_role' => (string)$role]]);
}

// changing current role for upcoming queries, if we have one:
$role = $c['current_role'] ?? null;
if ($role) {
    if (!@pg_query($pg, 'SET ROLE ' . pg_escape_identifier($pg, (string)$role))) pg_fail($pg, 'SET ROLE failed');
}

if ('list_roles' === $action) {
    $res = @pg_query($pg, "
        SELECT json_build_object(
            'all_roles',
                json_agg(r.rolname ORDER BY r.rolname)
                    FILTER (WHERE pg_has_role(session_user, r.oid, 'USAGE')),
            'current_roles',
                json_agg(r.rolname ORDER BY r.rolname)
                    FILTER (WHERE pg_has_role(current_user, r.oid, 'USAGE'))
        ) AS roles
        FROM pg_roles r
    ");
    if (!$res) pg_fail($pg, 'Query failed');

    $row = pg_fetch_assoc($res);
    @pg_close($pg);
    j(['data' => $row['roles']]);
}

if ('query' === $action) {
    if (!isset($in['sql']) || !is_string($in['sql'])) fail('Missing sql');

    if (isset($in['params'])) {
        if (!is_array($in['params']) || !array_is_list($in['params'])) fail('params must be an array');
        $params = array_map(fn($v) => is_bool($v) ? ($v ? 't' : 'f') : (is_array($v) ? json_encode($v) : $v), $in['params']);
        $res = @pg_query_params($pg, $in['sql'], $params);
    } else {
        $res = @pg_query($pg, $in['sql']);
    }
    if (!$res) pg_fail($pg, 'Query failed');

    $rows = pg_fetch_all($res);
    $meta = ['affected_rows' => pg_affected_rows($res)];

    @pg_close($pg);

    j(['data' => $rows ?: [], 'meta' => $meta]);
}

// Token for the event daemon (notifyd). What the client may see is decided by the
// database: notify.claims() runs under the user's current role.
if ('event_token' === $action) {
    if (empty($pgsql_events['secret'])) { @pg_close($pg); fail('Event layer is not configured', 501); }
    if (empty($p['events_url'])) { @pg_close($pg); fail('Profile has no events_url', 501); }

    $res = @pg_query($pg, 'select session_user as sub, current_user as role, notify.claims()::text as claims');
    if (!$res) pg_fail($pg, 'notify.claims() failed');
    $row = pg_fetch_assoc($res);
    @pg_close($pg);

    $now = time();
    $claims = [
        'aud'    => $p['events_aud'] ?? $c['profile_id'],
        'sub'    => $row['sub'],
        'role'   => $row['role'],
        'topics' => json_decode($row['claims'], true) ?: new stdClass(),
        'iat'    => $now,
        'exp'    => $now + (int)$pgsql_events['ttl'],
    ];
    $head = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $body = b64url(json_encode($claims, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $sig  = b64url(hash_hmac('sha256', "$head.$body", $pgsql_events['secret'], true));

    j(['data' => ['token' => "$head.$body.$sig", 'url' => $p['events_url'], 'exp' => $claims['exp']]]);
}

@pg_close($pg);
j(['error' => 'Invalid action: ' . $action]);
