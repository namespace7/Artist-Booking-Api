require('dotenv').config();

const pool = require('./mysql');

async function checkConnection() {
  try {
    const [rows] = await pool.query(
      'SELECT DATABASE() AS databaseName, 1 AS connectionWorks'
    );

    console.log('MySQL connection successful:', rows[0]);
  } catch (error) {
    console.error('MySQL connection failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

checkConnection();