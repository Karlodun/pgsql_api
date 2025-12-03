<?php
/**
 * Lightweight PostgreSQL API Server
 * 
 * This script provides a minimal interface for executing PostgreSQL queries via AJAX.
 * It stores connection parameters in PHP session and creates connections on-demand.
 * 
 * Security model: No additional user management or permissions - everything is handled by PostgreSQL.
 * The user credentials are the same as those used to connect to PostgreSQL directly.
 * 
 * Connection parameters are stored in PHP session, but actual connections are created
 * only when needed and closed after each request.
 */

// Start session to store connection parameters
session_start();

// Set content type to JSON
header('Content-Type: application/json');

/**
 * Handles incoming AJAX requests to connect to PostgreSQL databases and execute queries.
 * 
 * Request types:
 * - Connection: { action: 'connect', host: '...', dbname: '...', user: '...', password: '...', name: 'optional_id' }
 * - Query: { action: 'query', sql: '...', connection: 'optional_connection_id' }
 * - Set Role: { action: 'set_role', role: '...', connection: 'optional_connection_id' }
 */
try {
    // Get request data
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        throw new Exception('Invalid JSON input');
    }
    
    $action = $input['action'] ?? null;
    
    switch ($action) {
        case 'connect':
            handleConnect($input);
            break;
        case 'query':
            handleQuery($input);
            break;
        case 'set_role':
            handleSetRole($input);
            break;
        default:
            throw new Exception('Invalid action specified');
    }
} catch (Exception $e) {
    // Return error as JSON
    echo json_encode(['error' => $e->getMessage()]);
    exit;
}

/**
 * Handle connection request
 */
function handleConnect($input) {
    $host = $input['host'] ?? null;
    $dbname = $input['dbname'] ?? null;
    $user = $input['user'] ?? null;
    $password = $input['password'] ?? null;
    $port = $input['port'] ?? 5432;
    $name = $input['name'] ?? null;
    
    if (!$host || !$dbname || !$user || !$password) {
        throw new Exception('Missing required connection parameters (host, dbname, user, password)');
    }
    
    // Generate connection ID if not provided
    if (!$name) {
        $name = uniqid('conn_', true);
    }
    
    // Store connection parameters in session
    if (!isset($_SESSION['connections'])) {
        $_SESSION['connections'] = [];
    }
    
    $_SESSION['connections'][$name] = [
        'host' => $host,
        'dbname' => $dbname,
        'user' => $user,
        'password' => $password,
        'port' => $port
    ];
    
    // Set as default if it's the first connection
    if (count($_SESSION['connections']) === 1) {
        $_SESSION['default_connection'] = $name;
    }
    
    // Return connection ID
    echo json_encode(['connection_id' => $name]);
}

/**
 * Handle query execution
 */
function handleQuery($input) {
    $sql = $input['sql'] ?? null;
    $connectionId = $input['connection'] ?? null;
    
    if ($sql === null) {
        throw new Exception('SQL query is required');
    }
    
    // Get connection to use
    $connectionId = getConnectionId($connectionId);
    
    // Get connection parameters
    $connParams = $_SESSION['connections'][$connectionId] ?? null;
    if (!$connParams) {
        throw new Exception('Connection not found: ' . $connectionId);
    }
    
    // Create connection string
    $connString = "host={$connParams['host']} port={$connParams['port']} dbname={$connParams['dbname']} user={$connParams['user']} password={$connParams['password']}";
    
    // Connect to database
    $connection = pg_connect($connString);
    if (!$connection) {
        throw new Exception('Could not connect to database');
    }
    
    // Execute query
    $result = pg_query($connection, $sql);
    if (!$result) {
        $error = pg_last_error($connection);
        pg_close($connection);
        throw new Exception($error);
    }
    
    // Fetch results
    $rows = [];
    while ($row = pg_fetch_assoc($result)) {
        $rows[] = $row;
    }
    
    // Close connection
    pg_close($connection);
    
    // Return results
    echo json_encode(['data' => $rows]);
}

/**
 * Handle changing current role
 */
function handleSetRole($input) {
    $role = $input['role'] ?? null;
    $connectionId = $input['connection'] ?? null;
    
    if ($role === null) {
        throw new Exception('Role is required');
    }
    
    // Get connection to use
    $connectionId = getConnectionId($connectionId);
    
    // Get connection parameters
    $connParams = $_SESSION['connections'][$connectionId] ?? null;
    if (!$connParams) {
        throw new Exception('Connection not found: ' . $connectionId);
    }
    
    // Create connection string
    $connString = "host={$connParams['host']} port={$connParams['port']} dbname={$connParams['dbname']} user={$connParams['user']} password={$connParams['password']}";
    
    // Connect to database
    $connection = pg_connect($connString);
    if (!$connection) {
        throw new Exception('Could not connect to database');
    }
    
    // Set role
    $sql = "SET ROLE '$role'";
    $result = pg_query($connection, $sql);
    if (!$result) {
        $error = pg_last_error($connection);
        pg_close($connection);
        throw new Exception($error);
    }
    
    // Close connection
    pg_close($connection);
    
    // Return success
    echo json_encode(['success' => true]);
}

/**
 * Get connection ID to use, with fallback to default
 */
function getConnectionId($connectionId) {
    if ($connectionId) {
        return $connectionId;
    }
    
    if (isset($_SESSION['default_connection'])) {
        return $_SESSION['default_connection'];
    }
    
    // If no specific connection and no default, use the first available
    if (isset($_SESSION['connections']) && count($_SESSION['connections']) > 0) {
        $keys = array_keys($_SESSION['connections']);
        return $keys[0];
    }
    
    throw new Exception('No connections available');
}