require('dotenv').config();
const mysql = require('mysql2/promise');

// Hosted MySQL providers (Aiven, TiDB Cloud, Railway, ...) usually require TLS: set DB_SSL=true.
// If the provider gives you a CA certificate, paste it into DB_SSL_CA (use \n for line breaks).
let ssl;
if (process.env.DB_SSL === 'true') {
  ssl = process.env.DB_SSL_CA
    ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') }
    : { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ucu_lost_found',
  ssl,
  dateStrings: true,          // return DATE columns as 'YYYY-MM-DD' text
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 15000,
});
