(function () {
    // Initialize global variables for connections and SQL history
    if (typeof window.pg_sql_connection === 'undefined') {
      window.pg_sql_connection = {
        active: null,
        connections: {},
      };
    }
  
    if (typeof window.pg_sql_history === 'undefined') {
      window.pg_sql_history = [];
    }
  
    /**
     * Initialize the form UI module: creates the collapsible form.
     */
    function initializeFormUi() {
      createPgSqlApiForm();
    }
  
    /**
     * Dynamically creates the collapsible form with a toggle button.
     */
    function createPgSqlApiForm() {
      const container = document.createElement('div');
      container.id = 'pg_sql_api_container';
  
      // Invisible checkbox for visibility toggle
      const visibilityCheckbox = document.createElement('input');
      visibilityCheckbox.type = 'checkbox';
      visibilityCheckbox.id = 'pg_sql_api_toggle';
      visibilityCheckbox.style.display = 'none';
  
      // Label for the checkbox (acts as the toggle button)
      const toggleLabel = document.createElement('label');
      toggleLabel.setAttribute('for', 'pg_sql_api_toggle');
      toggleLabel.id = 'pg_sql_api_label';
      toggleLabel.innerText = '☰ Manage Connections and SQL';
  
      // The collapsible form container
      const formContainer = document.createElement('div');
      formContainer.id = 'pg_sql_api';
  
      // Connection Management Fieldset
      const connFieldset = createConnectionFieldset();
      formContainer.appendChild(connFieldset);
  
      // SQL Execution Fieldset
      const sqlFieldset = createSqlFieldset();
      formContainer.appendChild(sqlFieldset);
  
      // Append elements to the main container
      container.appendChild(visibilityCheckbox);
      container.appendChild(toggleLabel);
      container.appendChild(formContainer);
  
      // Append the container to the body
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
  
      // Create input for SQL
      const sqlInput = document.createElement('textarea');
      sqlInput.id = 'pg_sql_cli';
      sqlInput.rows = 5;
      sqlInput.style.width = '100%';
      sqlInput.placeholder = 'SELECT now();';
      fieldset.appendChild(sqlInput);
  
      // Add execute button
      const executeButton = document.createElement('button');
      executeButton.id = 'execute_sql';
      executeButton.innerText = 'Execute SQL';
      executeButton.onclick = handleExecuteSql;
      fieldset.appendChild(executeButton);
  
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
  
      window.pg_sql_connection.connections[credentials.id] = credentials;
      alert(`Connection "${credentials.id}" created successfully.`);
    }
  
    /**
     * Handles switching connections.
     */
    function handleSwitchConnection(event) {
      event.preventDefault();
      const connectionId = document.getElementById('conn_id').value;
  
      if (!window.pg_sql_connection.connections[connectionId]) {
        alert('Invalid Connection ID.');
        return;
      }
  
      window.pg_sql_connection.active = connectionId;
      alert(`Switched to connection "${connectionId}".`);
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
     * Handles reviewing connections.
     */
    function handleReviewConnections(event) {
      event.preventDefault();
      alert(JSON.stringify(window.pg_sql_connection.connections, null, 2));
    }
  

/**
 * Handles executing an SQL query from the form.
 */
async function handleExecuteSql(event) {
    event.preventDefault();

    // Get the SQL input value
    const sqlInput = document.getElementById('pg_sql_cli').value;

    if (!sqlInput) {
      alert('Please enter an SQL query.');
      return;
    }

    try {
      await pg_sql(sqlInput, {
        onSuccess: (rows) => alert(JSON.stringify(rows, null, 2)),
        onError: (err) => alert(err),
      });
    } catch (error) {
      alert(error);
    }
  }
  
  
    // Initialize the form UI
    initializeFormUi();
  })();
  
// Dynamically load styles.css
(function loadStyles() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './form_ui.css'; // Adjust the path if necessary
    document.head.appendChild(link);
})();
