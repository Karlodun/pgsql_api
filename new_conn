function pgsql_new_conn(credentials) {
  if (!credentials.id) {
    credentials.id = generateConnectionId();
  }

  const requestBody = JSON.stringify({ action: 'login', credentials });

  const request = new XMLHttpRequest();
  request.open('POST', window.SERVER_PATH || 'http://localhost/pgsql_api/server.php', true);
  request.setRequestHeader('Content-Type', 'application/json');

  request.onload = function () {
    if (this.status >= 200 && this.status < 300) {
      const response = JSON.parse(this.response);
      if (response.success) {
        const connectionId = credentials.id;

        // Store credentials in the global object
        window.pg_sql_connection.connections[connectionId] = { ...credentials };
        window.pg_sql_connection.active = connectionId;

        console.log(`Logged in and stored connection "${connectionId}"`);
      } else {
        console.error('Server error:', response.error);
      }
    } else {
      console.error('HTTP error:', this.status, this.statusText);
    }
  };

  request.onerror = function () {
    console.error('Network error occurred during login.');
  };

  request.send(requestBody);
}
