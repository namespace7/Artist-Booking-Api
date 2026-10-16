const userRepository = require("../src/repositories/user.repository");
const pool = require("../src/config/mysql");

describe("User repository: findByEmail", function () {
  const suffix = `${process.pid}-${Date.now()}`;
  const fixtureEmail = `user-repo-fixture-${suffix}@example.com`;
  let insertedUserId;

  beforeAll(async function () {
    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, 'client')`,
      [fixtureEmail, "fixture-password-hash"],
    );
    insertedUserId = result.insertId;
  });

  afterAll(async function () {
    if (insertedUserId) {
      await pool.execute("DELETE FROM users WHERE id = ?", [insertedUserId]);
    }

    await pool.end();
  });

  it("returns the matching user", async function () {
    const user = await userRepository.findByEmail(fixtureEmail);

    expect(user).not.toBeNull();
    expect(user.id).toBe(insertedUserId);
    expect(user.email).toBe(fixtureEmail);
    expect(user.password_hash).toBe("fixture-password-hash");
    expect(user.role).toBe("client");
  });

  it("returns null when the user does not exist", async function () {
    const user = await userRepository.findByEmail(
      `missing-user-${suffix}@example.com`,
    );

    expect(user).toBeNull();
  });
});
