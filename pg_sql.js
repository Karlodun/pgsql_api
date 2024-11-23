// pg_sql.js

(function () {
  // Use a global variable for the server path
  const serverPath = window.SERVER_PATH || 'http://localhost'; // Default to localhost if not defined

  function executeSQL(query, onSuccess, onError) {
    const request = new XMLHttpRequest();
    const url = `${serverPath}/pgsql_api.php`;

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

    request.send(JSON.stringify({ query }));
  }

  // Export the function to be accessible globally
  window.executeSQL = executeSQL;
})();
