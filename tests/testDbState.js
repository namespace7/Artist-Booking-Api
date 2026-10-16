const os = require("os");
const path = require("path");

// Single source of truth shared by globalSetup, setupFiles, and
// globalTeardown. globalSetup writes the disposable database name here;
// setupFiles (which runs inside each test worker, right before test files
// are required) reads it back and injects it into process.env before
// src/config/mysql.js creates its pool. A file is used instead of
// process.env because Jest runs globalSetup in a different process from
// the test workers, so process.env mutations there do not reliably reach
// the suites.
const PREFIX = "artist_booking_phase8_test_";
const LIVE_DATABASE = "artist_booking";

// Exact expected shape of a generated disposable database name:
//   <PREFIX><pid>_<epoch-ms>, e.g. artist_booking_phase8_test_12345_1730000000000
// Validation is intentionally strict (full-string match) so that a
// malformed or tampered state file can never cause the live
// `artist_booking` database (or any other database) to be dropped.
const NAME_PATTERN = new RegExp(`^${PREFIX}\\d+_\\d+$`);

function makeDisposableName(pid, timestampMs) {
  return `${PREFIX}${pid}_${timestampMs}`;
}

function isValidDisposableName(name) {
  return (
    typeof name === "string" &&
    name !== LIVE_DATABASE &&
    NAME_PATTERN.test(name)
  );
}

const stateFile = path.join(
  os.tmpdir(),
  "artist-booking-phase8-test-db.json",
);

module.exports = {
  PREFIX,
  LIVE_DATABASE,
  NAME_PATTERN,
  stateFile,
  makeDisposableName,
  isValidDisposableName,
};
