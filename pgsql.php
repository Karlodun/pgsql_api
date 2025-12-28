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

$_SESSION['connections'] ??= [];
$_SESSION['default_connection'] ??= null;

function j($x): void {
    echo json_encode($x, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
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

    if (!$pg = @pg_connect(implode(' ', $parts))) j(['error' => 'Could not connect to database', 'details' => pg_last_error() ?: 'pg_connect() failed']);
    return $pg;
}


$in = json_decode(file_get_contents('php://input'), true); // if broken -> broken
$action = $in['action'] ?? null;

if (!$action) j(['error' => 'Missing action']);

if ('get_profiles' === $action) {
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
    $in['conn_id'] ??= random_conn_id(4);
    $c = $in['credentials'] ?? [];
    // limiting app_name to 64 chars:
    if (isset($c['application_name'])) $c['application_name'] = substr((string)$c['application_name'], 0, 64);

    $p = $pgsql_profiles[$in['profile_id']] ?? null;
    if (!is_array($p)) j(['error' => 'Unknown profile_id: ' . $in['profile_id']]);

    $pg = pg_connection($c, $p);

    if (!$res_dbrole = @pg_query($pg, "select session_user, current_role")) {
        $e = pg_last_error($pg) ?: 'Could not obtain session and current user';
        @pg_close($pg);
        j(['error' => $e]);
    }

    $val_dbrole = pg_fetch_assoc($res_dbrole) ?: []; pg_free_result($res_dbrole);

    $_SESSION['connections'][$in['conn_id']] = array_merge(
        $c,
        ['profile_id'   => $in['profile_id']],
        $val_dbrole
        );

    $_SESSION['default_connection'] ??= $in['conn_id'];

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

$pg = pg_connection($c, $p);
// if needed we can supply different current role to act from:
if ('set_role' === $action) {
    $c['current_role'] = $in['role']; // let it explode if missing, postgres will return an error.
    @pg_close($pg);
    j(['data' => ['current_role' => $in['role']]]);
}

// changing current role for upcoming queries, if we have one:
$role = $c['current_role'] ?? null;
if ($role) {
    if (!@pg_query($pg, 'SET ROLE ' . pg_escape_identifier($pg, (string)$role))) {
        j(['error' => pg_last_error($pg) ?: 'SET ROLE failed']);
    }
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
    if (!$res) { $e = pg_last_error($pg) ?: 'Query failed'; @pg_close($pg); j(['error' => $e]); }

    $row = pg_fetch_assoc($res);
    @pg_close($pg);
    j(['data' => $row['roles']]);
} 

if ('query' === $action) {
    $res = @pg_query($pg, $in['sql']);
    if (!$res) j(['error' => pg_last_error($pg) ?: 'Query failed']);

    $rows = pg_fetch_all($res);
    $meta = ['affected_rows' => pg_affected_rows($res)];

    @pg_close($pg);

    j(['data' => $rows ?: [], 'meta' => $meta]);
}

j(['error' => 'Invalid action: ' . $action]);
