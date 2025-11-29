/**
 * Switches the active connection.
 * Updates the `window.pg_sql_connection.active` property to the specified connection ID.
 * @param {string} connection_id - The connection ID to switch to.
 * @returns {void}
 */
const PG_SQL_ENDPOINT = window.SERVER_PATH || '/pg_sql.php';

function pgsql_switch(connection_id) {
    if (!window.pg_sql_connection.connections[connection_id]) {
      console.error(`Connection ID "${connection_id}" does not exist.`);
      return;
    }

    window.pg_sql_connection.active = connection_id;
    console.log(`Switched to connection "${connection_id}".`);

    // Keep the server-side active marker in sync for default queries
    fetch(PG_SQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'set_active', connection_id }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.active_connection) {
          window.pg_sql_connection.active = payload.active_connection;
        }
      })
      .catch((error) => console.warn('Unable to sync active connection:', error));
  }
  
