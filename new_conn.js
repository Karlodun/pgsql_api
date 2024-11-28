// Ensure the global SERVER_PATH is defined
// Dynamically detect the SERVER_PATH based on the script location
if (typeof window.SERVER_PATH === 'undefined') {
  const script = document.currentScript || document.querySelector('script[src$="main.js"]');
  const scriptPath = script.src.split('/').slice(0, -1).join('/'); // Get the script's directory
  window.SERVER_PATH = `${scriptPath}/server.php`;
}


/**
 * Creates a new database connection by sending credentials to the server.
 * Optionally generates a connection ID if not provided.
 * @param {object} credentials - Database credentials: { id, host, user, password, database }.
 * @returns {void}
 */
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
      try {
        const response = JSON.parse(this.responseText);
        if (response.success) {
          window.pg_sql_connection.connections[credentials.id] = { ...credentials };
          window.pg_sql_connection.active = credentials.id;
          console.log(`Logged in and stored connection "${credentials.id}"`);
        } else {
          console.error('Server error:', response.error);
        }
      } catch (error) {
        console.error('Error parsing server response:', this.responseText);
      }
    } else {
      console.error('Login failed with status:', this.status, this.statusText);
    }
  };

  request.onerror = function () {
    console.error('Network error occurred during login.');
  };

  request.send(requestBody);
}
