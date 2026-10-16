require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");

// Placeholder used in sql/seed.sql in place of the demo accounts' password
// hash. It is substituted at runtime so that neither the plaintext password
// nor a ready-made hash is ever committed to the repository.
const HASH_PLACEHOLDER = "__DEMO_SEED_PASSWORD_HASH__";
const BCRYPT_COST = 10;
const SEED_SQL_PATH = path.resolve(__dirname, "../seed.sql");

async function seedMysql() {
  const demoPassword = process.env.DEMO_SEED_PASSWORD;

  if (!demoPassword) {
    throw new Error(
      "DEMO_SEED_PASSWORD is not set. Add a local-only development password to your .env (never commit it) before seeding.",
    );
  }

  if (!process.env.MYSQL_DATABASE) {
    throw new Error(
      "MYSQL_DATABASE is not configured. Refusing to seed an unspecified MySQL database.",
    );
  }

  let seedSql = fs.readFileSync(SEED_SQL_PATH, "utf8");

  if (!seedSql.includes(HASH_PLACEHOLDER)) {
    throw new Error(
      `Seed SQL '${SEED_SQL_PATH}' does not contain the expected placeholder '${HASH_PLACEHOLDER}'. Refusing to seed.`,
    );
  }

  // Hash at runtime; the plaintext and the resulting hash exist only in
  // memory and are never written to disk or logged.
  const passwordHash = await bcrypt.hash(demoPassword, BCRYPT_COST);
  seedSql = seedSql.split(HASH_PLACEHOLDER).join(passwordHash);

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
  });

  try {
    await connection.query(seedSql);
    console.log(
      `Seeded MySQL demo data into database '${process.env.MYSQL_DATABASE}' (bcrypt cost ${BCRYPT_COST}).`,
    );
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  seedMysql().catch((error) => {
    console.error("MySQL seed failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { seedMysql, HASH_PLACEHOLDER };
