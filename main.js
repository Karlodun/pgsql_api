// Ensure the global connection object is initialized
if (typeof window.pg_sql_connection === 'undefined') {
    window.pg_sql_connection = {
      active: null, // Currently active connection ID
      connections: {}, // All known connections with credentials
    };
  }
  
  /**
   * Dynamically loads a JavaScript file.
   * @param {string} src - The URL or path of the JavaScript file to load.
   * @returns {Promise<void>} A Promise that resolves when the script is loaded.
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.type = 'text/javascript';
      script.async = true;
  
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
  
      document.head.appendChild(script);
    });
  }
  
  /**
   * Main initialization function to load all required scripts.
   */
  async function initialize() {
    try {
      await loadScript('new_conn.js');
      await loadScript('pg_sql.js');
      await loadScript('switch.js');
      console.log('All scripts loaded successfully!');
    } catch (error) {
      console.error(error.message);
    }
  }
  
  // Start initialization
  initialize();
  
