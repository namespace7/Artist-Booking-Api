const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const pool = require("../src/config/mysql");

describe("Booking status integration", function () {
  let artistId;
  let clientId;
  let bookingId;
  let token;

  const suffix = Date.now();

  beforeAll(async function () {
    if (!process.env.JWT_SECRET) {
      throw new Error(
        "Set JWT_SECRET in .env before running integration tests",
      );
    }

    const [artistResult] = await pool.execute(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, 'artist')`,
      [`booking-artist-${suffix}@example.com`, "integration-test-hash"],
    );
    artistId = artistResult.insertId;

    const [clientResult] = await pool.execute(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, 'client')`,
      [`booking-client-${suffix}@example.com`, "integration-test-hash"],
    );
    clientId = clientResult.insertId;

    const [bookingResult] = await pool.execute(
      `INSERT INTO bookings
         (artist_id, client_id, event_start, event_end, notes, status)
       VALUES (?, ?, ?, ?, ?, 'completed')`,
      [
        artistId,
        clientId,
        "2026-11-01 10:00:00",
        "2026-11-01 11:00:00",
        "Integration test booking",
      ],
    );
    bookingId = bookingResult.insertId;
    console.log({
      artistId,
      clientId,
      bookingId,
    });

    token = jwt.sign(
      { userId: artistId, role: "artist" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
  });

  afterAll(async function () {
    if (bookingId) {
      await pool.execute("DELETE FROM bookings WHERE id = ?", [bookingId]);
    }

    if (artistId) {
      await pool.execute("DELETE FROM users WHERE id = ?", [artistId]);
    }

    if (clientId) {
      await pool.execute("DELETE FROM users WHERE id = ?", [clientId]);
    }

    await pool.end();
  });

  it("returns 422 when a completed booking is changed back to confirmed", async function () {
    const response = await request(app)
      .patch("/bookings/" + bookingId + "/status")
      .set("Authorization", "Bearer " + token)
      .send({ status: "confirmed" });

    console.log("Booking status response:", response.status, response.body);
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe(
      "Cannot transition booking from completed to confirmed",
    );
  });
});
