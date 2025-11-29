# pgsql_api

A lightweight JavaScript API that enables web applications (or devices) to connect to a PostgreSQL database via a PHP webserver while leaning on PostgreSQL itself for authentication, authorization, and access control. Each client logs in with its own database credentials; the server persists those credentials in a short-lived PHP session cookie and then proxies parameterized queries through to PostgreSQL. The session can keep multiple connection profiles alive at once, allowing the same page to send queries to different PostgreSQL servers without re-authenticating.
JS > AJAX > PostgreSQL api.

## Features

- Simplified interaction with PostgreSQL from web applications
- Secure communication via a PHP backend
- Uses PostgreSQL for authentication and access control
- Supports multiple simultaneous PostgreSQL sessions per browser session

## Prerequisites

- A webserver with PHP support
- PostgreSQL database configured and accessible
- Proper CORS configuration for cross-origin requests (if applicable)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Karlodun/pgsql_api.git
```

Configure your PHP webserver to serve `pg_sql.php`. Ensure the PostgreSQL credentials are managed securely on the server.

Include the pg_sql.js file in your web application.

# Configuration
Backend (PHP)

Update the `pg_sql.php` script with the following:

    PostgreSQL connection settings (e.g., hostname, port, database name)
    Session hardening options (secure/HttpOnly cookies, SameSite protection)
    Ensure proper security for handling incoming credentials and queries.

Frontend (JavaScript)

Include the pg_sql.js file in your HTML:

<script>
  // Set the API server path
  window.SERVER_PATH = 'https://your-php-server.com';
</script>
<script src="pg_sql.js"></script>

Usage

Call the executeSQL function to interact with the PostgreSQL database. Positional parameters are supported to keep queries safe. You can register multiple servers and switch between them without re-entering passwords. A "default" connection is simply whatever you have switched to most recently, but each query can also be routed to a specific connection ID without changing that default:

// Create two connections and keep the first one active
await pgsql_new_conn({
  id: 'main_db',
  host: 'db-primary',
  user: 'web',
  password: 'secret',
  database: 'app',
});

await pgsql_new_conn(
  {
    id: 'reporting_db',
    host: 'db-reports',
    user: 'reports',
    password: 'secret',
    database: 'reports',
  },
  { setActive: false },
);

// Simple query against the active connection using the (query, onSuccess) shape
pg_sql('SELECT * FROM users', (rows) => console.log(rows));

// Switch to the reporting database for long-running analytics
pgsql_switch('reporting_db');
pg_sql('SELECT count(*) FROM events WHERE created_at > now() - interval \''1 day\'';', (rows) => {
  console.log(rows);
});

// Run a single query on a specific connection without changing the default
pg_sql('SELECT * FROM logs LIMIT 10', {
  connectionId: 'reporting_db',
  onSuccess: (rows) => console.log('Logs:', rows),
});

// Parameterized query with callbacks
pg_sql(
  'SELECT * FROM users WHERE username = $1',
  {
    params: ['johndoe'],
    onSuccess: (rows) => console.log(rows),
    onError: (err) => console.error(err),
  }
);

// Positional parameters shape remains available for legacy callers
pg_sql('SELECT * FROM users WHERE username = $1', ['johndoe'], (rows) => console.log(rows));

The helper accepts three call shapes for backward compatibility while keeping the implementation readable:

1. `pg_sql(query, [params], onSuccess?, onError?)`
2. `pg_sql(query, onSuccess, onError?)`
3. `pg_sql(query, { params?, onSuccess?, onError?, connectionId? })`

Parameters

    query: The SQL query string to execute.
    onSuccess(response): Callback function to handle successful responses.
    onError(error): Callback function to handle errors.

Example Response

[
  { "id": 1, "username": "johndoe" },
  { "id": 2, "username": "janedoe" }
]

Security Considerations

    Always validate and sanitize user inputs on the server to prevent SQL injection; the API uses prepared statements for all queries.
    Use HTTPS to secure communication between the client and the server; session cookies are configured as HttpOnly and SameSite=Lax.
    Do not expose sensitive database connection details in the frontend.

License

This project is licensed under the MIT License.


---

### Summary of Changes:
1. The hardcoded path was replaced with a dynamic global variable (`window.SERVER_PATH`).
2. Updated documentation explains how to configure both the backend and frontend properly.
3. Included a security section in the `README.md` to emphasize best practices.

Created with Support of ChatGPT
