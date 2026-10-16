const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const {
  stateFile,
  makeDisposableName,
  isValidDisposableName,
} = require("./testDbState");

require("dotenv").config({ quiet: true });

module.exports = async function globalSetup() {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-jwt-secret-phase8";
  }

  // Never clobber a previous run's recovery record. A leftover state file
  // means an earlier run did not finish teardown; abort and let a human
  // reconcile the orphaned record/database instead of silently overwriting
  // it (which could leak a database with no remaining pointer).
  if (fs.existsSync(stateFile)) {
    throw new Error(
      `Refusing to start: disposable test database state file already exists at ${stateFile}. ` +
        `A previous test run may not have torn down cleanly. Inspect the file, drop the listed ` +
        `database if it still exists, remove the state file, then retry.`,
    );
  }

  const testDbName = makeDisposableName(process.pid, Date.now());

  if (!isValidDisposableName(testDbName)) {
    throw new Error(`Invalid test database name generated: ${testDbName}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: true,
  });

  let created = false;
  let stateWritten = false;

  try {
    const [existing] = await connection.query("SHOW DATABASES LIKE ?", [
      testDbName,
    ]);

    if (existing.length > 0) {
      throw new Error(
        `Disposable test database '${testDbName}' already exists unexpectedly. Aborting rather than dropping it.`,
      );
    }

    await connection.query(`CREATE DATABASE \`${testDbName}\``);
    created = true;

    // Persist recovery info as soon as the database exists, so a failure
    // while applying the schema can never leak an untracked database.
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        name: testDbName,
        pid: process.pid,
        createdAt: Date.now(),
      }),
    );
    stateWritten = true;

    const schemaPath = path.resolve(__dirname, "../sql/schema.sql");
    let schemaSql = fs.readFileSync(schemaPath, "utf8");

    schemaSql = schemaSql
      .replace(/CREATE DATABASE IF NOT EXISTS artist_booking\s*;/i, "")
      .replace(/USE artist_booking\s*;/i, `USE \`${testDbName}\`;`);

    await connection.query(schemaSql);

    process.env.MYSQL_DATABASE = testDbName;
  } catch (error) {
    if (created) {
      // Best-effort rollback. Only remove the state file if the database was
      // actually dropped; otherwise keep it as the manual-recovery record.
      let dropped = false;
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${testDbName}\``);
        dropped = true;
      } catch (dropError) {
        error.message +=
          ` Cleanup also failed (${dropError.message}); the disposable database ` +
          `'${testDbName}' may still exist and the state file ${stateFile} was preserved for recovery.`;
      }

      if (dropped && stateWritten) {
        fs.rmSync(stateFile, { force: true });
      }
    }
    throw error;
  } finally {
    await connection.end();
  }
};
