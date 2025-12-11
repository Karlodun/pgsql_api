<?php
session_start();
header('Content-Type: application/json');

// Read incoming JSON request
$data = json_decode(file_get_contents('php://input'), true);
$action = $data['action'] ?? null;

// Handle Login Action
if ($action === 'login') {
    $credentials = $data['credentials'] ?? null;

    if (!$credentials || !isset($credentials['host'], $credentials['user'], $credentials['password'], $credentials['database'])) {
        echo json_encode(['error' => 'Invalid credentials']);
        exit;
    }

    try {
        // Test the connection to verify credentials
        $dsn = "pgsql:host={$credentials['host']};dbname={$credentials['database']}";
        $pdo = new PDO($dsn, $credentials['user'], $credentials['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);

        // Store credentials in the session
        $_SESSION['pg_sql_connection'] = $credentials;

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// Handle Disconnect Action
if ($action === 'disconnect') {
    unset($_SESSION['pg_sql_connection']);
    echo json_encode(['success' => true]);
    exit;
}

// Handle Query Execution
if (!isset($_SESSION['pg_sql_connection'])) {
    echo json_encode(['error' => 'No active connection']);
    exit;
}

$credentials = $_SESSION['pg_sql_connection'];

try {
    // Recreate the PDO object for the current request
    $dsn = "pgsql:host={$credentials['host']};dbname={$credentials['database']}";
    $pdo = new PDO($dsn, $credentials['user'], $credentials['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    $query = $data['query'] ?? null;

    if ($query) {
        $stmt = $pdo->query($query);
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($result);
    } else {
        echo json_encode(['error' => 'No query provided']);
    }
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
