const request = require("supertest");
const app = require("../src/app");
const authService = require("../src/services/auth.service");

describe("POST /auth/login", function () {
  afterEach(function () {
    jest.clearAllMocks();
  });

  it("returns a token when credentials are valid", async function () {
    authService.login = jest.fn().mockResolvedValue({
      token: "test-jwt-token",
      user: {
        id: 1,
        email: "client@example.com",
        role: "client",
      },
    });
    const response = await request(app).post("/auth/login").send({
      email: "client@example.com",
      password: "correct-password",
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBe("test-jwt-token");
    expect(response.body.data.user.role).toBe("client");
  });

  it("returns 401 when credentials are invalid", async function () {
    authService.login = jest.fn().mockResolvedValue(null);

    const response = await request(app).post("/auth/login").send({
      email: "client@example.com",
      password: "wrong-password",
    });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe("Invalid email or password");
  });

  it("returns 400 when required fields are missing", async function () {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "client@example.com" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe("Email and password are required");
    expect(authService.login).not.toHaveBeenCalled();
  });
});
