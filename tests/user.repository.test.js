const userRepository = require("../src/repositories/user.repository");
const pool = require("../src/config/mysql");

describe("User repository: findByEmail", function () {
  afterAll(async function () {
    await pool.end();
  });

  it("returns the matching user", async function () {
    const user = await userRepository.findByEmail(
      "repository-test@example.com",
    );

    expect(user).not.toBeNull();
    expect(user.email).toBe("repository-test@example.com");
    expect(user.role).toBe("client");
    expect(user.id).toBeDefined();
  });

  it("returns null when the user does not exist", async function () {
    const user = await userRepository.findByEmail(
      "missing-user-987@example.com",
    );

    expect(user).toBeNull();
  });
});
