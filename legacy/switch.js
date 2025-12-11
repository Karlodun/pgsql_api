/**
 * Switches the active connection.
 * Updates the `window.pg_sql_connection.active` property to the specified connection ID.
 * @param {string} connection_id - The connection ID to switch to.
 * @returns {void}
 */
function pgsql_switch(connection_id) {
    if (!window.pg_sql_connection.connections[connection_id]) {
      console.error(`Connection ID "${connection_id}" does not exist.`);
      return;
    }
  
    window.pg_sql_connection.active = connection_id;
    console.log(`Switched to connection "${connection_id}".`);
  }
  
