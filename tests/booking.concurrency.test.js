const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const pool = require("../src/config/mysql");

const HOUR_MS = 60 * 60 * 1000;

describe("Booking concurrency and double-booking protection", function () {
  const suffix = `${process.pid}-${Date.now()}`;
  const createdBookingIds = [];
  const createdUserIds = [];

  async function createUser(emailPrefix, role) {
    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash, role)
       VALUES (?, ?, ?)`,
      [
        `${emailPrefix}-${suffix}-${createdUserIds.length}@example.com`,
        "concurrency-test-hash",
        role,
      ],
    );
    createdUserIds.push(result.insertId);
    return result.insertId;
  }

  function signToken(userId, role) {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
  }

  // Booking windows are always described as JS Dates and passed to MySQL
  // as bound parameters, never as naive string literals. This keeps the
  // stored values, the overlap checks, and the ISO strings sent to the
  // API internally consistent regardless of the Node process timezone or
  // the MySQL session timezone.
  function hoursFromNow(hours) {
    return new Date(Date.now() + hours * HOUR_MS);
  }

  async function insertBooking(
    artistId,
    clientId,
    eventStart,
    eventEnd,
    status,
    notes,
  ) {
    const [result] = await pool.execute(
      `INSERT INTO bookings
         (artist_id, client_id, event_start, event_end, notes, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [artistId, clientId, eventStart, eventEnd, notes, status],
    );
    createdBookingIds.push(result.insertId);
    return result.insertId;
  }

  afterAll(async function () {
    for (const id of createdBookingIds) {
      await pool.execute("DELETE FROM bookings WHERE id = ?", [id]);
    }
    for (const id of createdUserIds) {
      await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    }
    await pool.end();
  });

  it("Scenario A: rejects both concurrent POST /bookings requests with 409 when an overlapping confirmed booking exists", async function () {
    const artistId = await createUser("conc-a-artist", "artist");
    const client1Id = await createUser("conc-a-client1", "client");
    const client2Id = await createUser("conc-a-client2", "client");

    const client1Token = signToken(client1Id, "client");
    const client2Token = signToken(client2Id, "client");

    const base = hoursFromNow(24 * 60);
    const confirmedStart = base;
    const confirmedEnd = new Date(base.getTime() + 3 * HOUR_MS);

    await insertBooking(
      artistId,
      client1Id,
      confirmedStart,
      confirmedEnd,
      "confirmed",
      "Pre-existing confirmed booking",
    );

    const request1Start = new Date(base.getTime() + 1 * HOUR_MS);
    const request1End = new Date(base.getTime() + 2 * HOUR_MS);
    const request2Start = new Date(base.getTime() + 2 * HOUR_MS);
    const request2End = new Date(base.getTime() + 4 * HOUR_MS);

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/bookings")
        .set("Authorization", `Bearer ${client1Token}`)
        .set("Idempotency-Key", "scenario-a-request-1")
        .send({
          artist_id: artistId,
          event_start: request1Start.toISOString(),
          event_end: request1End.toISOString(),
          notes: "Concurrent request 1 overlapping confirmed",
        }),
      request(app)
        .post("/bookings")
        .set("Authorization", `Bearer ${client2Token}`)
        .set("Idempotency-Key", "scenario-a-request-2")
        .send({
          artist_id: artistId,
          event_start: request2Start.toISOString(),
          event_end: request2End.toISOString(),
          notes: "Concurrent request 2 overlapping confirmed",
        }),
    ]);

    expect(res1.status).toBe(409);
    expect(res1.body.success).toBe(false);
    expect(res1.body.error).toBe(
      "Artist already has a confirmed booking during this time",
    );

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.error).toBe(
      "Artist already has a confirmed booking during this time",
    );
  });

  it("Scenario B: allows two concurrent overlapping POST /bookings requests when no confirmed booking exists and keeps both pending", async function () {
    const artistId = await createUser("conc-b-artist", "artist");
    const client1Id = await createUser("conc-b-client1", "client");
    const client2Id = await createUser("conc-b-client2", "client");

    const client1Token = signToken(client1Id, "client");
    const client2Token = signToken(client2Id, "client");

    const base = hoursFromNow(24 * 60);

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/bookings")
        .set("Authorization", `Bearer ${client1Token}`)
        .set("Idempotency-Key", "scenario-b-request-1")
        .send({
          artist_id: artistId,
          event_start: base.toISOString(),
          event_end: new Date(base.getTime() + 3 * HOUR_MS).toISOString(),
          notes: "Concurrent pending request 1",
        }),
      request(app)
        .post("/bookings")
        .set("Authorization", `Bearer ${client2Token}`)
        .set("Idempotency-Key", "scenario-b-request-2")
        .send({
          artist_id: artistId,
          event_start: new Date(base.getTime() + 1 * HOUR_MS).toISOString(),
          event_end: new Date(base.getTime() + 4 * HOUR_MS).toISOString(),
          notes: "Concurrent pending request 2",
        }),
    ]);

    if (res1.body && res1.body.data && res1.body.data.id) {
      createdBookingIds.push(res1.body.data.id);
    }
    if (res2.body && res2.body.data && res2.body.data.id) {
      createdBookingIds.push(res2.body.data.id);
    }

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.data.status).toBe("pending");
    expect(res2.body.data.status).toBe("pending");
    expect(res1.body.data.id).not.toBe(res2.body.data.id);

    const [dbRows] = await pool.execute(
      `SELECT id, status FROM bookings WHERE id IN (?, ?) ORDER BY id`,
      [res1.body.data.id, res2.body.data.id],
    );

    expect(dbRows).toHaveLength(2);
    expect(dbRows.every((row) => row.status === "pending")).toBe(true);
  });

  it("Scenario C: allows at most one overlapping pending booking to transition to confirmed across 5 repeated concurrent races", async function () {
    const iterations = 5;

    for (let round = 1; round <= iterations; round += 1) {
      const artistId = await createUser(`conc-c-r${round}-artist`, "artist");
      const client1Id = await createUser(`conc-c-r${round}-c1`, "client");
      const client2Id = await createUser(`conc-c-r${round}-c2`, "client");
      const artistToken = signToken(artistId, "artist");

      const base = hoursFromNow(24 * 60);
      const bookingAId = await insertBooking(
        artistId,
        client1Id,
        base,
        new Date(base.getTime() + 3 * HOUR_MS),
        "pending",
        `Race round ${round} booking A`,
      );
      const bookingBId = await insertBooking(
        artistId,
        client2Id,
        new Date(base.getTime() + 1.5 * HOUR_MS),
        new Date(base.getTime() + 4.5 * HOUR_MS),
        "pending",
        `Race round ${round} booking B`,
      );

      const [resA, resB] = await Promise.all([
        request(app)
          .patch(`/bookings/${bookingAId}/status`)
          .set("Authorization", `Bearer ${artistToken}`)
          .send({ status: "confirmed" }),
        request(app)
          .patch(`/bookings/${bookingBId}/status`)
          .set("Authorization", `Bearer ${artistToken}`)
          .send({ status: "confirmed" }),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const conflictResponse = resA.status === 409 ? resA : resB;
      expect(conflictResponse.body.success).toBe(false);
      expect(conflictResponse.body.error).toBe(
        "Artist already has a confirmed booking during this time",
      );

      const [dbRows] = await pool.execute(
        `SELECT id, status FROM bookings WHERE artist_id = ?`,
        [artistId],
      );

      const confirmedRows = dbRows.filter((row) => row.status === "confirmed");
      const pendingRows = dbRows.filter((row) => row.status === "pending");

      expect(confirmedRows).toHaveLength(1);
      expect(pendingRows).toHaveLength(1);
    }
  });
});
