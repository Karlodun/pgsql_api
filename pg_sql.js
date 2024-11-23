// sql.js (already existing file)
function sql(sql_code, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://localhost/apps/sql.php', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.send('sql_code=' + encodeURIComponent(sql_code));

    xhr.onload = function() {
        if (xhr.status != 200) {
            sql_error(`Error ${xhr.status}: ${xhr.statusText}`);
        } else {
            try {
                const response = JSON.parse(xhr.response);
                if (response.error) {
                    sql_error(response.error);
                } else {
                    callback(response); // Pass the data to the callback function
                }
            } catch (e) {
                sql_error("Invalid JSON response");
            }
        }
    };

    xhr.onerror = function() {
        sql_error("Request failed");
    };
}

// Error handling function
function sql_error(error_text) {
    console.log("SQL Error: " + error_text);
}
