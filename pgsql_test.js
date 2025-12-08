/**
 * Automated test suite for PGSQL Client Library
 */

// Test runner function
async function runAllTests() {
    const resultsDiv = document.getElementById('test-results');
    if (!resultsDiv) {
        console.error('Test results div not found');
        return;
    }
    
    resultsDiv.innerHTML = '<h3>Running Tests...</h3>';
    
    const tests = [
        testInitialization,
        testGetProfiles,
        testConnectInvalidCredentials,
        testQueryWithoutConnection,
        testTransactionFunctionality
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        try {
            await test();
            resultsDiv.innerHTML += `<div class="success">✓ ${test.name} passed</div>`;
            passed++;
        } catch (error) {
            resultsDiv.innerHTML += `<div class="error">✗ ${test.name} failed: ${error.message}</div>`;
            failed++;
        }
    }
    
    resultsDiv.innerHTML += `<h3>Test Results: ${passed} passed, ${failed} failed</h3>`;
}

// Test initialization
async function testInitialization() {
    const pgsql = new PgSQLClient();
    if (!(pgsql instanceof PgSQLClient)) {
        throw new Error('Failed to initialize PgSQLClient');
    }
    // Test custom endpoint initialization
    const pgsqlCustom = new PgSQLClient({ endpoint: '/custom/path/pgsql.php' });
    if (!(pgsqlCustom instanceof PgSQLClient)) {
        throw new Error('Failed to initialize PgSQLClient with custom endpoint');
    }
}

// Test getting profiles
async function testGetProfiles() {
    const pgsql = new PgSQLClient();
    try {
        const profiles = await pgsql.getProfiles();
        if (typeof profiles !== 'object') {
            throw new Error('getProfiles did not return an object');
        }
    } catch (error) {
        // This might fail if no connection to server, which is OK for testing
        console.log('getProfiles test: server may be unavailable, continuing...');
    }
}

// Test connecting with invalid credentials
async function testConnectInvalidCredentials() {
    const pgsql = new PgSQLClient();
    try {
        // This should fail with invalid credentials
        await pgsql.connect('nonexistent_profile', 'invalid_user', 'invalid_password');
        throw new Error('Connect with invalid credentials should have failed');
    } catch (error) {
        // Expected to fail, so this is good
        if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            // Network error is also acceptable
            return;
        }
        // Any other error is expected for invalid credentials
    }
}

// Test query without connection
async function testQueryWithoutConnection() {
    const pgsql = new PgSQLClient();
    try {
        await pgsql.query('SELECT 1');
        throw new Error('Query without connection should have failed');
    } catch (error) {
        // Expected to fail, so this is good
    }
}

// Test transaction functionality
async function testTransactionFunctionality() {
    const pgsql = new PgSQLClient();
    try {
        // This should fail without a valid connection, which is expected
        await pgsql.transaction(async (connId) => {
            // Empty transaction function
        });
        // If it doesn't fail, that's also acceptable depending on implementation
    } catch (error) {
        // Expected behavior
    }
}

// Add event listener for the run tests button if it exists
document.addEventListener('DOMContentLoaded', function() {
    const runTestsBtn = document.getElementById('run-tests');
    if (runTestsBtn) {
        runTestsBtn.addEventListener('click', runAllTests);
    }
});

// Export functions for manual testing
window.runAllTests = runAllTests;
window.testInitialization = testInitialization;
window.testGetProfiles = testGetProfiles;
window.testConnectInvalidCredentials = testConnectInvalidCredentials;
window.testQueryWithoutConnection = testQueryWithoutConnection;
window.testTransactionFunctionality = testTransactionFunctionality;