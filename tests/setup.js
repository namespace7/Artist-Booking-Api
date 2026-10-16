const fs = require("fs");

const { stateFile, isValidDisposableName } = require("./testDbState");

require("dotenv").config({ quiet: true });

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-phase8";
}

// Point every test worker's pool at the disposable database created by
// tests/globalSetup.js. This runs before the test file (and therefore
// before src/config/mysql.js) is required, so the pool picks up the
// disposable database. If the state file is missing we fail loudly
// rather than silently falling back to the live `artist_booking` database.
if (!fs.existsSync(stateFile)) {
  throw new Error(
    "Phase 8 test database state file is missing. globalSetup did not run.",
  );
}

const { name } = JSON.parse(fs.readFileSync(stateFile, "utf8"));

if (!isValidDisposableName(name)) {
  throw new Error(`Refusing to run tests against non-disposable db: ${name}`);
}

process.env.MYSQL_DATABASE = name;
