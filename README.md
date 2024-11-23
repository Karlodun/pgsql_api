# pgsql_api

A lightweight JavaScript API that enables web applications to connect to a PostgreSQL database via a PHP webserver. It leverages PostgreSQL for authentication, authorization, and access control.
JS > AJAX > PostgreSQL api.
## Features

- Simplified interaction with PostgreSQL from web applications
- Secure communication via a PHP backend
- Uses PostgreSQL for authentication and access control

## Prerequisites

- A webserver with PHP support
- PostgreSQL database configured and accessible
- Proper CORS configuration for cross-origin requests (if applicable)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Karlodun/pgsql_api.git
```
Configure your PHP webserver to serve pgsql_api.php. Ensure the PostgreSQL credentials are managed securely on the server.

Include the pg_sql.js file in your web application.

# Configuration
Backend (PHP)

Update the pgsql_api.php script with the following:

    PostgreSQL connection settings (e.g., hostname, port, database name)
    Ensure proper security for handling incoming credentials and queries.

Frontend (JavaScript)

Include the pg_sql.js file in your HTML:

<script>
  // Set the API server path
  window.SERVER_PATH = 'https://your-php-server.com';
</script>
<script src="pg_sql.js"></script>

Usage

Call the executeSQL function to interact with the PostgreSQL database:

pg_sql(
  'SELECT * FROM users', 
  (response) => {
    console.log('Query result:', response);
  },
  (error) => {
    console.error('Error:', error);
  }
);

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

    Always validate and sanitize user inputs on the server to prevent SQL injection.
    Use HTTPS to secure communication between the client and the server.
    Do not expose sensitive database connection details in the frontend.

License

This project is licensed under the MIT License.


---

### Summary of Changes:
1. The hardcoded path was replaced with a dynamic global variable (`window.SERVER_PATH`).
2. Updated documentation explains how to configure both the backend and frontend properly.
3. Included a security section in the `README.md` to emphasize best practices.

Created with Support of ChatGPT
