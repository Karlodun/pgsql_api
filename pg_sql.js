/**
 * Global connection state for pg_sql.
 * Mutable and tracks active connections.
 */
if (typeof window.pg_sql_connection === 'undefined') {
  window.pg_sql_connection = {
    active: null, // Currently active connection ID
    connections: {}, // All known connections { connection_id: true/false }
  };
}

(function () {
  const serverPath = window.SERVER_PATH || 'http://localhost/pgsql_api/server.php'; // Default server path

  /**
   * Executes an SQL query using the currently active connection.
   * Logs the result to the console or returns the result to the calling function.
   * @param {string} query - The SQL query to execute.
   * @returns {void}
   */
  function pg_sql(query) {
    const activeConnection = window.pg_sql_connection.active;
    if (!activeConnection) {
      console.error('No active connection. Use pg_target_login to log in.');
      return;
    }

    const requestBody = JSON.stringify({ query, connection_id: activeConnection });

    const request = new XMLHttpRequest();
    request.open('POST', serverPath, true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        const response = JSON.parse(this.response);
        console.log('Query result:', response); // Log the result to console
      } else {
        console.error('Query failed with status:', this.status, this.statusText);
      }
    };

    request.onerror = function () {
      console.error('Network error occurred during query execution.');
    };

    request.send(requestBody);
  }

  /**
   * Logs in to the database and establishes a new connection.
   * @param {object} credentials - Database credentials: { host, port, username, password, dbname }.
   * @param {string|null} connection_id - Optional unique ID for the connection.
   * @returns {void}
   */
  function pg_target_login(credentials, connection_id = null) {
    if (!connection_id) {
      connection_id = generateConnectionId();
    }

    const requestBody = JSON.stringify({ action: 'login', credentials, connection_id });

    const request = new XMLHttpRequest();
    request.open('POST', serverPath, true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        window.pg_sql_connection.connections[connection_id] = true;
        window.pg_sql_connection.active = connection_id;
        console.log('Logged in with connection ID:', connection_id);
      } else {
        console.error('Login failed with status:', this.status, this.statusText);
      }
    };

    request.onerror = function () {
      console.error('Network error occurred during login.');
    };

    request.send(requestBody);
  }

  /**
   * Switches the active connection or disconnects from the server.
   * @param {string|null} connection_id - Connection ID to switch to, or null to disconnect.
   * @returns {void}
   */
  function pg_sql_connection_switch(connection_id = null) {
    if (connection_id) {
      if (!window.pg_sql_connection.connections[connection_id]) {
        console.error('Invalid connection ID.');
        return;
      }
      window.pg_sql_connection.active = connection_id;
      console.log('Switched to connection ID:', connection_id);
      return;
    }

    const requestBody = JSON.stringify({ action: 'disconnect' });

    const request = new XMLHttpRequest();
    request.open('POST', serverPath, true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        delete window.pg_sql_connection.active;
        console.log('Disconnected from server.');
      } else {
        console.error('Disconnection failed with status:', this.status, this.statusText);
      }
    };

    request.onerror = function () {
      console.error('Network error occurred during disconnection.');
    };

    request.send(requestBody);
  }

  /**
   * Generates a unique connection ID.
   * This ensures each connection has a unique identifier within the current session.
   * @returns {string} A unique connection ID.
   */
  function generateConnectionId() {
    let connection_id;
    do {
      connection_id = 'conn_' + Math.random().toString(36).substr(2, 5);
    } while (window.pg_sql_connection.connections[connection_id]);
    return connection_id;
  }

  // Export functions globally to allow usage across the application
  window.pg_sql = pg_sql;
  window.pg_target_login = pg_target_login;
  window.pg_sql_connection_switch = pg_sql_connection_switch;
})();
