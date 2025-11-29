// Ensure the global connection object is initialized
if (typeof window.pg_sql_connection === 'undefined') {
  window.pg_sql_connection = {
    active: null, // Currently active connection ID
    connections: {}, // All known connections with credentials
  };
}

const PG_SQL_ENDPOINT = window.SERVER_PATH || '/pg_sql.php';

/**
 * Convert all supported pg_sql() call shapes into a single, explicit options object.
 *
 * Supported shapes:
 *   1) (query, [params], onSuccess?, onError?)
 *   2) (query, onSuccess, onError?)
 *   3) (query, { params?, onSuccess?, onError?, connectionId?/connection_id? })
 */
function normalizePgSqlOptions(query, paramsOrOptions, successCallback, errorCallback) {
  // Backwards compatible signature: (query, paramsArray, onSuccess?, onError?)
  if (Array.isArray(paramsOrOptions)) {
    return {
      query,
      params: paramsOrOptions,
      onSuccess: successCallback,
      onError: errorCallback,
      connectionId: undefined,
    };
  }

  // Legacy callback signature: (query, onSuccess, onError?)
  if (typeof paramsOrOptions === 'function') {
    return {
      query,
      params: [],
      onSuccess: paramsOrOptions,
      onError: successCallback,
      connectionId: undefined,
    };
  }

  // Preferred signature: (query, { params?, onSuccess?, onError?, connectionId?/connection_id? })
  const options = paramsOrOptions && typeof paramsOrOptions === 'object' ? paramsOrOptions : {};
  return {
    query,
    params: Array.isArray(options.params) ? options.params : [],
    onSuccess: options.onSuccess,
    onError: options.onError,
    connectionId: options.connectionId || options.connection_id,
  };
}

/**
 * Executes an SQL query using the currently active connection (or the one provided
 * via `connectionId`). Logs the result to the console when no callbacks are provided.
 * @param {string} query - The SQL query to execute.
 * @param {Array|Object|Function} [paramsOrOptions] - Parameters array, callback, or options object.
 * @param {Function} [successCallback] - Optional success callback (legacy positional use).
 * @param {Function} [errorCallback] - Optional error callback (legacy positional use).
 * @returns {Promise<void>}
 */
async function pg_sql(query, paramsOrOptions, successCallback, errorCallback) {
  const { params, onSuccess, onError, connectionId } = normalizePgSqlOptions(
    query,
    paramsOrOptions,
    successCallback,
    errorCallback,
  );

  const targetConnectionId = connectionId || window.pg_sql_connection.active;
  if (!targetConnectionId) {
    const error = new Error(
      'No default connection. Use pgsql_switch to pick a default or pass { connectionId } to pg_sql.',
    );
    console.error(error.message);
    onError?.(error);
    throw error;
  }

  const connection = window.pg_sql_connection.connections[targetConnectionId];
  if (!connection) {
    const error = new Error(`Connection ID "${targetConnectionId}" does not exist.`);
    console.error(error.message);
    onError?.(error);
    throw error;
  }

  const requestBody = JSON.stringify({
    action: 'query',
    query,
    params,
    connection_id: targetConnectionId,
  });

  try {
    const response = await fetch(PG_SQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      throw new Error(`Error parsing server response: ${text}`);
    }

    if (!response.ok || payload.error) {
      const message = payload?.error || `Query failed with status: ${response.status}`;
      console.error(message);
      const error = new Error(message);
      onError?.(error);
      throw error;
    }

    if (payload.active_connection) {
      window.pg_sql_connection.active = payload.active_connection;
    }

    if (onSuccess) {
      onSuccess(payload.rows);
    } else {
      console.log('Query Result:', payload.rows);
    }
  } catch (error) {
    console.error('Network or server error:', error.message || error);
    onError?.(error);
    throw error;
  }
}
