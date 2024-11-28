// Initialize global variables for connections and SQL history
if (typeof window.pg_sql_history === 'undefined') {
  window.pg_sql_history = [];
}
if (typeof window.pg_sql_connection === 'undefined') {
  window.pg_sql_connection = {
    active: null,
    connections: {},
  };
}

(function () {
  /**
   * Dynamically creates the form with id "pg_sql_api".
   */
  function createPgSqlApiForm() {
    const container = document.createElement('div');
    container.id = 'pg_sql_api';
    container.style.border = '1px solid #ccc';
    container.style.padding = '10px';
    container.style.margin = '10px';

    // Create connection management fieldset
    const connFieldset = createConnectionFieldset();
    container.appendChild(connFieldset);

    // Create SQL execution fieldset
    const sqlFieldset = createSqlFieldset();
    container.appendChild(sqlFieldset);

    // Append to body
    document.body.appendChild(container);
  }

  /**
   * Creates the connection management fieldset.
   */
  function createConnectionFieldset() {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.innerText = 'Connection Management';
    fieldset.appendChild(legend);

    // Create inputs for credentials
    const inputs = ['ID', 'Host', 'User', 'Password', 'Database'];
    inputs.forEach((label) => {
      const inputGroup = document.createElement('div');
      const inputLabel = document.createElement('label');
      inputLabel.innerText = `${label}: `;
      const inputField = document.createElement('input');
      inputField.type = 'text';
      inputField.id = `conn_${label.toLowerCase()}`;
      inputGroup.appendChild(inputLabel);
      inputGroup.appendChild(inputField);
      fieldset.appendChild(inputGroup);
    });

    // Add buttons
    const buttons = [
      { id: 'create_conn', text: 'Create Connection', onClick: handleCreateConnection },
      { id: 'switch_conn', text: 'Switch Connection', onClick: handleSwitchConnection },
      { id: 'drop_conn', text: 'Drop Connection', onClick: handleDropConnection },
      { id: 'review_creds', text: 'Review Connections', onClick: handleReviewConnections },
      { id: 'store_creds', text: 'Store Credentials in Cookie', onClick: storeConnectionsInCookie },
      { id: 'retrieve_creds', text: 'Retrieve Credentials from Cookie', onClick: retrieveConnectionsFromCookie },
    ];

    buttons.forEach(({ id, text, onClick }) => {
      const button = document.createElement('button');
      button.id = id;
      button.innerText = text;
      button.style.margin = '5px';
      button.onclick = onClick;
      fieldset.appendChild(button);
    });

    return fieldset;
  }

  /**
   * Creates the SQL execution fieldset.
   */
  function createSqlFieldset() {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.innerText = 'SQL Execution';
    fieldset.appendChild(legend);

    // Create history container
    const historyContainer = document.createElement('div');
    historyContainer.id = 'sql_history';
    historyContainer.style.marginBottom = '10px';
    fieldset.appendChild(historyContainer);
    updateSqlHistory();

    // Create input for SQL
    const sqlInput = document.createElement('textarea');
    sqlInput.id = 'sql_input';
    sqlInput.rows = 5;
    sqlInput.style.width = '100%';
    fieldset.appendChild(sqlInput);

    // Add buttons
    const buttons = [
      { id: 'execute_sql', text: 'Execute SQL', onClick: handleExecuteSql },
      { id: 'store_history', text: 'Store History in Cookie', onClick: storeHistoryInCookie },
      { id: 'retrieve_history', text: 'Retrieve History from Cookie', onClick: retrieveHistoryFromCookie },
    ];

    buttons.forEach(({ id, text, onClick }) => {
      const button = document.createElement('button');
      button.id = id;
      button.innerText = text;
      button.style.margin = '5px';
      button.onclick = onClick;
      fieldset.appendChild(button);
    });

    return fieldset;
  }

  /**
   * Handles creating a new connection.
   */
  function handleCreateConnection(event) {
    event.preventDefault();

    const credentials = {
      id: document.getElementById('conn_id').value,
      host: document.getElementById('conn_host').value,
      user: document.getElementById('conn_user').value,
      password: document.getElementById('conn_password').value,
      database: document.getElementById('conn_database').value,
    };

    if (!credentials.id) {
      alert('Connection ID is required.');
      return;
    }

    pgsql_new_conn(credentials); // Assume pgsql_new_conn is already implemented
  }

  /**
   * Handles switching to a different connection.
   */
  function handleSwitchConnection(event) {
    event.preventDefault();
    const connectionId = document.getElementById('conn_id').value;

    if (!window.pg_sql_connection.connections[connectionId]) {
      alert('Invalid Connection ID.');
      return;
    }

    pgsql_switch(connectionId); // Assume pgsql_switch is already implemented
  }

  /**
   * Handles dropping a connection.
   */
  function handleDropConnection(event) {
    event.preventDefault();
    const connectionId = document.getElementById('conn_id').value;

    if (!window.pg_sql_connection.connections[connectionId]) {
      alert('Invalid Connection ID.');
      return;
    }

    delete window.pg_sql_connection.connections[connectionId];
    if (window.pg_sql_connection.active === connectionId) {
      window.pg_sql_connection.active = null;
    }
    alert(`Connection "${connectionId}" has been dropped.`);
  }

  /**
   * Handles reviewing existing connections.
   */
  function handleReviewConnections(event) {
    event.preventDefault();
    alert(JSON.stringify(window.pg_sql_connection.connections, null, 2));
  }

  /**
   * Handles executing an SQL query.
   */
  function handleExecuteSql(event) {
    event.preventDefault();

    const sqlInput = document.getElementById('sql_input').value;
    if (!sqlInput) {
      alert('Please enter an SQL query.');
      return;
    }

    addSqlToHistory(sqlInput);
    pg_sql(sqlInput); // Assume pg_sql is already implemented
  }

  /**
   * Adds a query to the SQL history.
   */
  function addSqlToHistory(query) {
    const frozenQueries = window.pg_sql_history.filter((item) => item.frozen);
    const newHistory = frozenQueries.concat([{ query, frozen: false }]);

    window.pg_sql_history = newHistory.slice(-10);
    updateSqlHistory();
  }

  /**
   * Updates the SQL history UI.
   */
  function updateSqlHistory() {
    const historyContainer = document.getElementById('sql_history');
    historyContainer.innerHTML = '';

    window.pg_sql_history.forEach((item, index) => {
      const historyItem = document.createElement('div');
      historyItem.style.display = 'flex';
      historyItem.style.alignItems = 'center';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.frozen;
      checkbox.onchange = () => (item.frozen = checkbox.checked);

      const label = document.createElement('span');
      label.innerText = item.query;
      label.style.marginLeft = '5px';
      label.style.cursor = 'pointer';
      label.onclick = () => {
        document.getElementById('sql_input').value = item.query;
      };

      historyItem.appendChild(checkbox);
      historyItem.appendChild(label);
      historyContainer.appendChild(historyItem);
    });
  }

  /**
   * Stores SQL history in a cookie.
   */
  function storeHistoryInCookie() {
    document.cookie = `sql_history=${encodeURIComponent(JSON.stringify(window.pg_sql_history))}; path=/;`;
    alert('SQL history has been stored in a cookie.');
  }

  /**
   * Retrieves SQL history from a cookie.
   */
  function retrieveHistoryFromCookie() {
    const cookieValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('sql_history='))
      ?.split('=')[1];

    if (cookieValue) {
      window.pg_sql_history = JSON.parse(decodeURIComponent(cookieValue));
      updateSqlHistory();
      alert('SQL history has been retrieved from a cookie.');
    } else {
      alert('No SQL history found in cookies.');
    }
  }

  /**
   * Stores connection credentials in a cookie.
   */
  function storeConnectionsInCookie() {
    document.cookie = `pg_sql_connection=${encodeURIComponent(
      JSON.stringify(window.pg_sql_connection.connections)
    )}; path=/;`;
    alert('Connection credentials have been stored in a cookie.');
  }

  /**
   * Retrieves connection credentials from a cookie.
   */
  function retrieveConnectionsFromCookie() {
    const cookieValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('pg_sql_connection='))
      ?.split('=')[1];

    if (cookieValue) {
      window.pg_sql_connection.connections = JSON.parse(decodeURIComponent(cookieValue));
      alert('Connection credentials have been retrieved from a cookie.');
    } else {
      alert('No connection credentials found in cookies.');
    }
 
