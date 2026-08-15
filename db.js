const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    // Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date objects --
    // otherwise the driver silently reinterprets them through a timezone, which was
    // shifting task deadlines by a day depending on server/browser timezone offsets.
    dateStrings: ['DATE']
});

module.exports = pool;
