/**
 * Dynamically loads a JavaScript or CSS file.
 * @param {string} src - The URL or path of the file to load.
 * @param {string} type - The type of file: 'js' or 'css'.
 * @returns {Promise<void>} A Promise that resolves when the file is loaded.
 */
function loadFile(src, type) {
  return new Promise((resolve, reject) => {
    let element;
    if (type === 'js') {
      element = document.createElement('script');
      element.src = src;
      element.type = 'text/javascript';
    } else if (type === 'css') {
      element = document.createElement('link');
      element.href = src;
      element.rel = 'stylesheet';
    } else {
      reject(new Error('Unsupported file type.'));
      return;
    }

    element.onload = () => resolve();
    element.onerror = () => reject(new Error(`Failed to load ${type} file: ${src}`));

    if (type === 'js') {
      document.body.appendChild(element);
    } else {
      document.head.appendChild(element);
    }
  });
}

/**
 * Load all required files and initialize the application.
 */
async function initializeApp() {
  try {
//    await loadFile('form_ui.js', 'js'); // optional and should rather be loaded directly.
    await loadFile('new_conn.js', 'js');
    await loadFile('switch.js', 'js');
    await loadFile('pg_sql.js', 'js');
    console.log('All scripts loaded successfully!');
  } catch (error) {
    console.error(error.message);
  }
}

// Initialize the app
initializeApp();
