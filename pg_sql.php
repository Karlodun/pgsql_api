<?php
// sql.php
session_start();

// Check if credentials are stored in the session
if (!isset($_SESSION['pg_role']) || !isset($_SESSION['pg_pwd']) || !isset($_SESSION['pg_host']) || !isset($_SESSION['pg_db'])) {
    http_response_code(403);
    echo "Unauthorized: No database credentials found in session.";
    exit();
}

// Get SQL code from the request
if (isset($_POST['sql_code'])) {

    try {
        // Create a new PDO instance
        $dsn = "pgsql:host=".$_SESSION['pg_host'].";dbname=".$_SESSION['pg_db'];
        $pdo = new PDO($dsn, $_SESSION['pg_role'], $_SESSION['pg_pwd'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

        // Execute SQL query
        $stmt = $pdo->query($$_POST['sql_code']);

        // Fetch all results
        $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Return the results as JSON
        echo json_encode($results);

    } catch (PDOException $e) {
        // Handle PDO errors
        http_response_code(500);
        echo "Database error: " . $e->getMessage();
    }
} else {
    http_response_code(400);
    echo "Bad request: No SQL code provided.";
}
?>
