/**
 * Lightweight PostgreSQL API Client
 * 
 * This JavaScript library provides a minimal interface for communicating with the
 * PostgreSQL API server (pgsql.php). It handles connection management and query
 * execution with a focus on simplicity and directness.
 * 
 * Security model: No additional user management or permissions - everything is 
 * handled by PostgreSQL. The user credentials are the same as those used to 
 * connect to PostgreSQL directly.
 * 
 * The client stores connection parameters and sends them with each request,
 * relying on the server to manage actual database connections.
 */

class PgSqlClient {
    /**
     * Create a new PostgreSQL API client
     * @param {string} serverUrl - URL to the pgsql.php server endpoint
     */
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
    }

    /**
     * Create a new database connection
     * @param {Object} params - Connection parameters
     * @param {string} params.host - Database host
     * @param {string} params.dbname - Database name
     * @param {string} params.user - Database user
     * @param {string} params.password - Database password
     * @param {number} [params.port=5432] - Database port
     * @param {string} [params.name] - Optional connection name/ID (server will generate if not provided)
     * @returns {Promise<Object>} Response containing connection_id and extended information
     */
    async connect(params) {
        const payload = {
            action: 'connect',
            ...params
        };

        return this._makeRequest(payload);
    }

    /**
     * Execute a SQL query
     * @param {string} sql - SQL query to execute
     * @param {string} [connectionId] - Optional connection ID to use (will use default if not specified)
     * @returns {Promise<Object>} Response containing either data with metadata or error
     */
    async query(sql, connectionId = null) {
        const payload = {
            action: 'query',
            sql: sql,
            connection: connectionId
        };

        return this._makeRequest(payload);
    }

    /**
     * Set the current role in the database
     * @param {string} role - Role to set as current role
     * @param {string} [connectionId] - Optional connection ID to use (will use default if not specified)
     * @returns {Promise<Object>} Response containing success status or error
     */
    async setRole(role, connectionId = null) {
        const payload = {
            action: 'set_role',
            role: role,
            connection: connectionId
        };

        return this._makeRequest(payload);
    }

    /**
     * Execute a transaction with multiple queries
     * @param {Array} queries - Array of SQL queries to execute in transaction
     * @param {string} [connectionId] - Optional connection ID to use (will use default if not specified)
     * @returns {Promise<Object>} Response containing results of all queries
     */
    async transaction(queries, connectionId = null) {
        // This would require server-side support for persistent connections
        // For now, we'll execute queries sequentially with BEGIN/COMMIT/ROLLBACK
        const results = [];
        
        // Begin transaction
        results.push(await this.query('BEGIN', connectionId));
        
        try {
            for (const query of queries) {
                const result = await this.query(query, connectionId);
                results.push(result);
            }
            
            // Commit transaction
            results.push(await this.query('COMMIT', connectionId));
        } catch (error) {
            // Rollback transaction
            await this.query('ROLLBACK', connectionId);
            throw error;
        }
        
        return results;
    }


    /**
     * Make an HTTP request to the server
     * @private
     */
    async _makeRequest(payload) {
        const response = await fetch(this.serverUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        // If the server returned an error, throw it
        if (result.error) {
            throw new Error(result.error);
        }

        return result;
    }
}

// Export the class for use in other modules
// In a browser environment, we'll attach it to the global window object
if (typeof window !== 'undefined') {
    window.PgSqlClient = PgSqlClient;
}

// For Node.js environments, we'll use module.exports
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PgSqlClient;
}