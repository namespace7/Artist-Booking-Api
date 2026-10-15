const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");

const { authenticateToken } = require("../src/middleware/auth.middleware");

describe("Authentication middleware", function () {
  let app;

  beforeAll(function () {
    process.env.JWT_SECRET = "test-secret-for-middleware";
    app = express();

    app.get("/protected", authenticateToken, function (req, res) {
      res.status(200).json({
        success: true,
        data: { user: req.user },
        error: null,
      });
    });
  });

  it("rejects requests without a token", async function () {
    const response = await request(app).get("/protected");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication token required");
  });

  it("rejects an invalid token", async function () {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid-token");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid or expired authentication token");
  });

  it("accepts a valid token and attaches the user", async function () {
    const token = jwt.sign(
      { userId: 12, role: "artist" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer " + token);

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: 12,
      role: "artist",
    });
  });

  it("rejects a token with an invalid role", async function () {
    const token = jwt.sign(
      { userId: 12, role: "admin" },
      process.env.JWT_SECRET,
    );
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer " + token);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid authentication token");
  });
});
