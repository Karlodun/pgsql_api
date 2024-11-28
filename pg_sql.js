// Ensure the global connection object is initialized
if (typeof window.pg_sql_connection === 'undefined') {
  window.pg_sql_connection = {
    active: null, // Currently active connection ID
    connections: {}, // All known connections with credentials
  };
}

/**
 * Executes an SQL query using the currently active connection.
 * Logs the result to the console.
 * @param {string} query - The SQL query to execute.
 * @returns {void}
 */
function pg_sql(query) {
  if (!window.pg_sql_connection.active) {
    console.error('No active connection. Use pgsql_switch to activate a connection.');
    return;
  }

  const connection = window.pg_sql_connection.connections[window.pg_sql_connection.active];
  if (!connection) {
    console.error('Active connection ID is invalid.');
    return;
  }

  const requestBody = JSON.stringify({
    action: 'query',
    query: query,
    connection_id: window.pg_sql_connection.active,
    credentials: connection,
  });

  const request = new XMLHttpRequest();
  request.open('POST', window.SERVER_PATH || '/server.php', true);
  request.setRequestHeader('Content-Type', 'application/json');

  request.onload = function () {
    if (this.status >= 200 && this.status < 300) {
      try {
        const response = JSON.parse(this.responseText);
        console.log('Query Result:', response);
      } catch (error) {
        console.error('Error parsing server response:', this.responseText);
      }
    } else {
      console.error('Query failed with status:', this.status, this.statusText);
    }
  };

  request.onerror = function () {
    console.error('Network error occurred during query execution.');
  };

  request.send(requestBody);
}
