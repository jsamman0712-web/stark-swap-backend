require("dotenv").config();
const sql = require("mssql");

const config = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port:     parseInt(process.env.DB_PORT),
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

let pool; // ✅ Fix #4: singleton pool — one connection reused across all requests

async function getConnection() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log("Connected to Azure SQL");
  }
  return pool;
}

module.exports = { sql, getConnection };