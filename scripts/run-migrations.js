require("dotenv").config();

const mysql = require("mysql2/promise");
const { runMigrations } = require("../lib/migrations");

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4"
  });

  try {
    await pool.query("SELECT 1");
    await runMigrations(pool);
    console.log("✅ Migraciones V2 completadas.");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("❌ Error ejecutando migraciones:", error.message);
  process.exit(1);
});
