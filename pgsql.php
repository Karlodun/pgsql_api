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

// Базовая защита от CSRF
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

/**
 * Handles incoming AJAX requests to connect to PostgreSQL databases and execute queries.
 * 
 * Request types:
 * - Get Profiles: { action: 'get_profiles' }
 * - Connection: { action: 'connect', profile_id: '...', user: '...', password: '...' }
 * - Query: { action: 'query', sql: '...', connection_id: 'optional_connection_id' }
 * - Set Role: { action: 'set_role', role: '...', connection_id: 'optional_connection_id' }
 */
try {
    // Get request data
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        throw new Exception('Invalid JSON input');
    }
    
    $action = $input['action'] ?? null;
    
    switch ($action) {
        case 'get_profiles':
            handleGetProfiles($input);
            break;
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
 * Handle getting available connection profiles
 */
function handleGetProfiles($input) {
    // Load profiles from configuration file
    $profiles = getProfilesList();
    
    echo json_encode(['profiles' => $profiles]);
}

/**
 * Handle connection request
 */
function handleConnect($input) {
    $profileId = $input['profile_id'] ?? null;
    $user = $input['user'] ?? null;
    $password = $input['password'] ?? null;
    $name = $input['name'] ?? null;
    
    if (!$profileId || !$user || !$password) {
        throw new Exception('Missing required connection parameters (profile_id, user, password)');
    }
    
    // Get profile configuration - in a real application, this would be loaded from a config file
    $profileConfig = getProfileConfig($profileId);
    if (!$profileConfig) {
        throw new Exception('Invalid profile ID: ' . $profileId);
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
        'host' => $profileConfig['host'],
        'dbname' => $profileConfig['dbname'],
        'user' => $user,
        'password' => $password,
        'port' => $profileConfig['port'] ?? 5432
    ];
    
    // Set as default if it's the first connection
    if (count($_SESSION['connections']) === 1) {
        $_SESSION['default_connection'] = $name;
    }
    
    // Test connection and get extended information
    $connParams = $_SESSION['connections'][$name];
    $connString = "host={$connParams['host']} port={$connParams['port']} dbname={$connParams['dbname']} user={$connParams['user']} password={$connParams['password']}";
    $connection = pg_connect($connString);
    if (!$connection) {
        throw new Exception('Could not connect to database');
    }
    
    $version = pg_version($connection);
    $server_encoding = pg_parameter_status($connection, 'server_encoding');
    pg_close($connection);
    
    // Return extended connection information
    echo json_encode([
        'connection_id' => $name,
        'server_version' => $version['server'],
        'server_encoding' => $server_encoding
    ]);
}

/**
 * Get profile configuration by ID
 * In a real application, this would load from a configuration file
 */
function getProfileConfig($profileId) {
    // Load configuration from external file
    $config_file = __DIR__ . '/pgsql_config.php';
    if (file_exists($config_file)) {
        include $config_file;
        return $pgsql_profiles[$profileId] ?? null;
    }
    
    // Fallback to hardcoded profiles if config file doesn't exist
    $profiles = [
        'dev_local' => [
            'host' => 'localhost',
            'dbname' => 'testdb',
            'port' => 5432,
            'description' => 'Local development database'
        ],
        'test_server' => [
            'host' => 'test.example.com',
            'dbname' => 'testdb',
            'port' => 5432,
            'description' => 'Testing environment database'
        ],
        'prod_main' => [
            'host' => 'prod.example.com',
            'dbname' => 'proddb',
            'port' => 5432,
            'description' => 'Main production database'
        ]
    ];
    
    return $profiles[$profileId] ?? null;
}

/**
 * Get list of available profiles with their information
 */
function getProfilesList() {
    // Load profile information from external file
    $config_file = __DIR__ . '/pgsql_config.php';
    if (file_exists($config_file)) {
        include $config_file;
        $profiles = [];
        foreach ($pgsql_profile_info as $id => $info) {
            $profiles[] = [
                'id' => $id,
                'name' => $info['name'],
                'class' => $info['class'],
                'description' => $info['description']
            ];
        }
        return $profiles;
    }
    
    // Fallback to hardcoded profiles if config file doesn't exist
    return [
        [
            'id' => 'dev_local',
            'name' => 'Local Development',
            'class' => 'Dev',
            'description' => 'Local development database'
        ],
        [
            'id' => 'test_server',
            'name' => 'Test Server',
            'class' => 'Test', 
            'description' => 'Testing environment database'
        ],
        [
            'id' => 'prod_main',
            'name' => 'Production Main',
            'class' => 'Prod',
            'description' => 'Main production database'
        ]
    ];
}

/**
 * Handle query execution
 */
function handleQuery($input) {
    $sql = $input['sql'] ?? null;
    $connectionId = $input['connection_id'] ?? null;
    
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
    
    // Measure execution time
    $start_time = microtime(true);
    
    // Execute query
    $result = pg_query($connection, $sql);
    if (!$result) {
        $error = pg_last_error($connection);
        pg_close($connection);
        throw new Exception($error);
    }
    
    $execution_time = microtime(true) - $start_time;
    
    // Fetch results
    $rows = [];
    while ($row = pg_fetch_assoc($result)) {
        $rows[] = $row;
    }
    
    // Get affected rows and query type
    $affected_rows = pg_affected_rows($result);
    $query_type = getQueryType($sql);
    $notice_messages = pg_last_notice($connection);
    
    // Close connection
    pg_close($connection);
    
    // Return results with metadata
    echo json_encode([
        'data' => $rows,
        'metadata' => [
            'affected_rows' => $affected_rows,
            'query_type' => $query_type,
            'execution_time' => $execution_time,
            'notice_messages' => $notice_messages
        ]
    ]);
}

/**
 * Handle changing current role
 */
function handleSetRole($input) {
    $role = $input['role'] ?? null;
    $connectionId = $input['connection_id'] ?? null;
    
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

/**
 * Determine the type of SQL query
 */
function getQueryType($sql) {
    $sql = trim($sql);
    $first_space_pos = strpos($sql, ' ');
    
    if ($first_space_pos === false) {
        // If there's no space, take the whole string as the first word
        $first_word = strtoupper($sql);
    } else {
        $first_word = strtoupper(substr($sql, 0, $first_space_pos));
    }
    
    switch ($first_word) {
        case 'SELECT':
            return 'SELECT';
        case 'INSERT':
            return 'INSERT';
        case 'UPDATE':
            return 'UPDATE';
        case 'DELETE':
            return 'DELETE';
        case 'CREATE':
            return 'DDL';
        case 'ALTER':
            return 'DDL';
        case 'DROP':
            return 'DDL';
        case 'TRUNCATE':
            return 'DDL';
        case 'BEGIN':
        case 'START':
        case 'COMMIT':
        case 'ROLLBACK':
            return 'TRANSACTION';
        default:
            return 'UNKNOWN';
    }
}