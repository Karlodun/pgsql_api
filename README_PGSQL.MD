# Lightweight PostgreSQL API Server

## Overview

This project provides a lightweight API server for executing PostgreSQL queries via AJAX requests. It operates as an intermediary between client-side JavaScript and PostgreSQL databases, supporting profile-based connections for enhanced security.

## Features

- **Profile-based connections**: Connect to predefined database profiles instead of specifying host/port directly
- **Session-based connection management**: Connection parameters are stored in PHP sessions
- **Extended metadata**: Query results include execution time, affected rows, query type, and notice messages
- **Transaction support**: Execute transactions with proper BEGIN/COMMIT/ROLLBACK handling
- **Role switching**: Change database roles dynamically
- **Security features**: Basic CSRF protection headers and input validation

## Architecture

### Server-side (pgsql.php)

The `pgsql.php` script handles AJAX requests with the following actions:

- `get_profiles`: Retrieve available connection profiles
- `connect`: Establish a connection using a profile ID
- `query`: Execute SQL queries
- `set_role`: Change the current database role

### Client-side (pgsql.js)

The `pgsql.js` library provides a convenient client-side API:

- `PgSQLClient` class for managing connections
- Profile management and connection establishment
- Query execution with metadata support
- Transaction helpers
- Role switching

## Setup

1. Place `pgsql.php` on your web server with PHP and PostgreSQL support
2. Configure database profiles in `pgsql_config.php`
3. Include `pgsql.js` in your HTML page
4. Use the API as described below

## Configuration

### pgsql_config.php

Create a `pgsql_config.php` file to define your database profiles:

```php
<?php
// Configuration file for PostgreSQL connection profiles

$pgsql_profiles = [
    'dev_local' => [
        'host' => 'localhost',
        'dbname' => 'mydb',
        'port' => 5432,
        'description' => 'Local development database'
    ],
    'prod_main' => [
        'host' => 'prod.example.com',
        'dbname' => 'proddb',
        'port' => 5432,
        'description' => 'Production database'
    ]
];

$pgsql_profile_info = [
    'dev_local' => [
        'name' => 'Local Development',
        'class' => 'Dev',
        'description' => 'Local development database'
    ],
    'prod_main' => [
        'name' => 'Production Main',
        'class' => 'Prod',
        'description' => 'Production database'
    ]
];
```

## Usage

### Client-side Examples

#### Initialize the client

```javascript
// Initialize with custom endpoint
const client = new PgSQLClient({ endpoint: '/api/pgsql.php' });

// Or use the global instance
pgsql.init({ endpoint: '/api/pgsql.php' });
```

#### Get available profiles

```javascript
const profiles = await pgsql.getProfiles();
console.log(profiles);
// Output: Array of profile objects with id, name, class, and description
```

#### Connect to a profile

```javascript
const connection = await pgsql.connect('dev_local', 'username', 'password');
console.log(connection.connection_id); // Connection ID
console.log(connection.server_version); // PostgreSQL server version
console.log(connection.server_encoding); // Server encoding
```

#### Execute queries

```javascript
// Simple query
const result = await pgsql.query('SELECT * FROM users WHERE id = $1', [123]);
console.log(result.data); // Query results
console.log(result.metadata); // Metadata including affected_rows, query_type, execution_time, etc.

// Query with specific connection
const result2 = await pgsql.query('SELECT COUNT(*) FROM users', [], 'conn_12345');
```

#### Transactions

```javascript
// Using transaction helper
const transactionResult = await pgsql.transaction(async (client, connectionId) => {
    await client.query('INSERT INTO orders (user_id, amount) VALUES (1, 100)', [], connectionId);
    await client.query('UPDATE users SET balance = balance - 100 WHERE id = 1', [], connectionId);
    // Transaction automatically commits if no error, or rolls back on error
}, connectionId);

// Manual transaction
await pgsql.begin(connectionId);
try {
    await pgsql.query('INSERT INTO orders (user_id, amount) VALUES (1, 100)', [], connectionId);
    await pgsql.query('UPDATE users SET balance = balance - 100 WHERE id = 1', [], connectionId);
    await pgsql.commit(connectionId);
} catch (error) {
    await pgsql.rollback(connectionId);
    throw error;
}
```

#### Change role

```javascript
await pgsql.setRole('readonly_user', connectionId);
```

## Security

- Host and port information is never exposed to the client
- Connection parameters are stored server-side in PHP sessions
- Basic validation of inputs
- CSRF protection headers
- Connection credentials are cleared from client-side memory after connection

## Error Handling

The library distinguishes between network errors and PostgreSQL errors:

- Network errors are thrown as standard JavaScript errors
- PostgreSQL errors are returned with the original error message from the database
- All operations return promises that can be caught for error handling

## API Reference

### PgSQLClient Class

#### `new PgSQLClient(options)`
- `options.endpoint` (optional): Custom endpoint URL for pgsql.php
- `options.credentials` (optional): Credentials mode for fetch requests (default: 'include')

#### `init(options)`
Initialize or reconfigure the client with new options.

#### `getProfiles()`
Returns a promise resolving to an array of available connection profiles.

#### `connect(profileId, user, password, options)`
- `profileId`: ID of the profile to connect to
- `user`: PostgreSQL username
- `password`: PostgreSQL password
- `options`: Additional options

Returns connection information including ID, server version, and encoding.

#### `query(sql, params, connectionId)`
- `sql`: SQL query string
- `params`: Array of parameters for prepared statements
- `connectionId`: Optional connection ID (uses default if not provided)

Returns an object with `data` (query results) and `metadata` (execution information).

#### `setRole(role, connectionId)`
- `role`: PostgreSQL role name to switch to
- `connectionId`: Optional connection ID

#### `begin(connectionId)`
Start a transaction.

#### `commit(connectionId)`
Commit a transaction.

#### `rollback(connectionId)`
Rollback a transaction.

#### `transaction(callback, connectionId)`
Execute a transaction using a callback function.

## Server Response Format

Query responses include metadata:

```json
{
  "data": [...], // Query results
  "metadata": {
    "affected_rows": 1,
    "query_type": "INSERT",
    "execution_time": 0.001234,
    "notice_messages": null
  }
}
```

## Development

This is a lightweight solution designed for rapid development and simple database access scenarios. For production applications, consider additional security measures, connection pooling, and more sophisticated error handling.

## License

This project is open source and available under the MIT License.