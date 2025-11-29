// Resolve the PHP endpoint once so all callers share the same value.
// If the host page sets window.SERVER_PATH explicitly, we respect it; otherwise we
// derive the path from the current script's directory.
const PG_SQL_ENDPOINT = (() => {
  if (typeof window.SERVER_PATH === 'string' && window.SERVER_PATH.trim()) {
    return window.SERVER_PATH;
  }

  const script = document.currentScript || document.querySelector('script[src$="main.js"]');
  const scriptPath = script?.src?.split('/')?.slice(0, -1)?.join('/');
  return scriptPath ? `${scriptPath}/pg_sql.php` : '/pg_sql.php';
})();

const REQUIRED_CREDENTIAL_FIELDS = ['host', 'user', 'password', 'database'];

function generateConnectionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `conn_${crypto.randomUUID()}`;
  }

  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateCredentials(credentials) {
  const missing = REQUIRED_CREDENTIAL_FIELDS.filter((field) => !credentials[field]);
  if (missing.length) {
    throw new Error(`Missing credential fields: ${missing.join(', ')}`);
  }
}

/**
 * Creates a new database connection by sending credentials to the server.
 * Optionally generates a connection ID if not provided.
 * @param {object} credentials - Database credentials: { id, host, user, password, database, port? }.
 * @param {boolean} [options.setActive] - When false, do not change the server-side active connection.
 * @returns {Promise<void>}
 */
async function pgsql_new_conn(credentials, options = {}) {
  if (!credentials.id) {
    credentials.id = generateConnectionId();
  }

  validateCredentials(credentials);

  const requestBody = JSON.stringify({
    action: 'login',
    credentials,
    set_active: options.setActive !== false,
  });

  const response = await fetch(PG_SQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Login failed with status ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || 'Unknown server error');
  }

  window.pg_sql_connection.connections[credentials.id] = { ...credentials };

  if (payload.active_connection) {
    window.pg_sql_connection.active = payload.active_connection;
  }

  console.log(
    `Logged in and stored connection "${credentials.id}". Active: ${window.pg_sql_connection.active}`,
  );
}
