<?php
session_start();

header('Content-Type: application/json');

// Handle incoming request
$data = json_decode(file_get_contents('php://input'), true);
$action = $data['action'] ?? null;

if ($action === 'disconnect') {
    // Destroy the session connection
    unset($_SESSION['pg_sql_connection']);
    echo json_encode(['success' => true]);
    exit;
}

if (!isset($_SESSION['pg_sql_connection'])) {
    // Attempt to initiate a new connection
    if ($action === 'login') {
        $credentials = $data['credentials'] ?? null;
        $connection_id = $data['connection_id'] ?? null;

        if ($credentials && $connection_id) {
            try {
                $dsn = "pgsql:host={$credentials['host']};dbname={$credentials['dbname']};port={$credentials['port']}";
                $pdo = new PDO($dsn, $credentials['username'], $credentials['password'], [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                ]);
                $_SESSION['pg_sql_connection'] = serialize($pdo);
                echo json_encode(['success' => true]);
                exit;
            } catch (Exception $e) {
                echo json_encode(['error' => $e->getMessage()]);
                exit;
            }
        }
    }
    echo json_encode(['error' => 'No active connection']);
    exit;
}

// Use the existing connection
if (isset($_SESSION['pg_sql_connection'])) {
    $pdo = unserialize($_SESSION['pg_sql_connection']);
    $query = $data['query'] ?? null;

    if ($query) {
        try {
            $stmt = $pdo->query($query);
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode($result);
        } catch (Exception $e) {
            echo json_encode(['error' => $e->getMessage()]);
        }
    } else {
        echo json_encode(['error' => 'No query provided']);
    }
}
?>
