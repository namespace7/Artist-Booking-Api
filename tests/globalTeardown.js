const fs = require("fs");
const mysql = require("mysql2/promise");

const { stateFile, isValidDisposableName } = require("./testDbState");

require("dotenv").config({ quiet: true });

module.exports = async function globalTeardown() {
  if (!fs.existsSync(stateFile)) {
    // Nothing to tear down (setup never ran, or already cleaned up).
    return;
  }

  const raw = fs.readFileSync(stateFile, "utf8");

  let testDbName;

  try {
    testDbName = JSON.parse(raw).name;
  } catch (error) {
    // Preserve the state file: it may be the only pointer to a leaked DB.
    throw new Error(
      `Could not parse disposable test database state file at ${stateFile}: ${error.message}. ` +
        `Preserving it for manual recovery; no database was dropped.`,
    );
  }

  // Refuse to ever drop anything that is not a strictly-valid disposable
  // database name (in particular, never the live `artist_booking` db).
  // The state file is deliberately NOT removed in this branch.
  if (!isValidDisposableName(testDbName)) {
    throw new Error(
      `Refusing to drop non-disposable database: '${testDbName}'. ` +
        `State file ${stateFile} preserved; no database was dropped.`,
    );
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
  } catch (error) {
    // Do NOT delete the state file if the drop failed; keep it for recovery.
    throw new Error(
      `Failed to drop disposable test database '${testDbName}': ${error.message}. ` +
        `State file ${stateFile} preserved for manual recovery.`,
    );
  } finally {
    await connection.end();
  }

  // Only now — after the name was validated and the drop succeeded — remove
  // the recovery record.
  fs.rmSync(stateFile, { force: true });
};
