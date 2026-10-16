const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const pool = require("../src/config/mysql");

describe("Booking status integration", function () {
  let artistId;
  let clientId;
  let bookingId;
  let token;
  let clientToken;

  const suffix = Date.now();

  function makeBookingBody() {
    const eventStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);

    return {
      artist_id: artistId,
      event_start: eventStart.toISOString(),
      event_end: eventEnd.toISOString(),
      notes: "Idempotency integration test",
    };
  }

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

    clientToken = jwt.sign(
      { userId: clientId, role: "client" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

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
    token = jwt.sign(
      { userId: artistId, role: "artist" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
  });

  afterAll(async function () {
    if (artistId || clientId) {
      await pool.execute(
        "DELETE FROM bookings WHERE client_id = ? OR artist_id = ?",
        [clientId || 0, artistId || 0],
      );
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

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe(
      "Cannot transition booking from completed to confirmed",
    );
  });

  it("returns the same booking when the same key and payload are retried", async function () {
    const key = "same-request-" + suffix;
    const body = makeBookingBody();

    const first = await request(app)
      .post("/bookings")
      .set("Authorization", "Bearer " + clientToken)
      .set("Idempotency-Key", key)
      .send(body);

    const second = await request(app)
      .post("/bookings")
      .set("Authorization", "Bearer " + clientToken)
      .set("Idempotency-Key", key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data).toEqual(first.body.data);

    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM bookings
       WHERE client_id = ? AND idempotency_key = ?`,
      [clientId, key],
    );

    expect(Number(rows[0].total)).toBe(1);
  });

  it("rejects the same key when the booking payload changes", async function () {
    const key = "changed-request-" + suffix;
    const body = makeBookingBody();

    const first = await request(app)
      .post("/bookings")
      .set("Authorization", "Bearer " + clientToken)
      .set("Idempotency-Key", key)
      .send(body);

    const second = await request(app)
      .post("/bookings")
      .set("Authorization", "Bearer " + clientToken)
      .set("Idempotency-Key", key)
      .send({
        ...body,
        notes: "Different booking details",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe(
      "Idempotency-Key has already been used with a different request",
    );

    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM bookings
       WHERE client_id = ? AND idempotency_key = ?`,
      [clientId, key],
    );

    expect(Number(rows[0].total)).toBe(1);
  });

  it("creates only one booking for simultaneous requests using the same key", async function () {
    const key = "concurrent-request-" + suffix;
    const body = makeBookingBody();

    const [first, second] = await Promise.all([
      request(app)
        .post("/bookings")
        .set("Authorization", "Bearer " + clientToken)
        .set("Idempotency-Key", key)
        .send(body),

      request(app)
        .post("/bookings")
        .set("Authorization", "Bearer " + clientToken)
        .set("Idempotency-Key", key)
        .send(body),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).toBe(second.body.data.id);

    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM bookings
       WHERE client_id = ? AND idempotency_key = ?`,
      [clientId, key],
    );

    expect(Number(rows[0].total)).toBe(1);
  });
});
