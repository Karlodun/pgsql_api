// Ensure pg_sql_connection is globally available and initialized only if not already defined
if (typeof window.pg_sql_connection === 'undefined') {
  window.pg_sql_connection = {}; // JSON to hold active connections
}

(function () {
  const serverPath = window.SERVER_PATH || 'http://localhost'; // Default to localhost if not set

  /**
   * Executes an SQL query using the active connection.
   */
  function pg_sql(query, onSuccess, onError) {
    const request = new XMLHttpRequest();
    const url = `${serverPath}/pgsql_api.php`;

    const activeConnection = window.pg_sql_connection.active || null;

    request.open('POST', url, true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        onSuccess(JSON.parse(this.response));
      } else {
        onError({
          status: this.status,
          statusText: this.statusText,
        });
      }
    };

    request.onerror = function () {
      onError({
        status: this.status,
        statusText: this.statusText,
      });
    };

    request.send(JSON.stringify({ query, connection_id: activeConnection }));
  }

  /**
   * Logs in to the database and establishes a new connection.
   */
  function pg_target_login(credentials, connection_id = null, onSuccess, onError) {
    const request = new XMLHttpRequest();
    const url = `${serverPath}/pgsql_api.php`;

    request.open('POST', url, true);
    request.setRequestHeader('Content-Type', 'application/json');

    if (!connection_id) {
      // Generate a unique short connection ID
      connection_id = 'conn_' + Math.random().toString(36).substr(2, 5);
      while (window.pg_sql_connection[connection_id]) {
        connection_id = 'conn_' + Math.random().toString(36).substr(2, 5);
      }
    }

    request.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        window.pg_sql_connection[connection_id] = true;
        window.pg_sql_connection.active = connection_id; // Switch to the new connection
        onSuccess(connection_id);
      } else {
        onError({
          status: this.status,
          statusText: this.statusText,
        });
      }
    };

    request.onerror = function () {
      onError({
        status: this.status,
        statusText: this.statusText,
      });
    };

    request.send(JSON.stringify({ action: 'login', credentials, connection_id }));
  }

  /**
   * Switches between active connections or disconnects.
   */
  function pg_sql_connection_switch(connection_id = null, onSuccess, onError) {
    const request = new XMLHttpRequest();
    const url = `${serverPath}/pgsql_api.php`;

    request.open('POST', url, true);
    
