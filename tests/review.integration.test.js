const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/config/mysql");

describe("GET /artists/:id/reviews integration", function () {
  const suffix = `${process.pid}-${Date.now()}`;
  const createdReviewIds = [];
  const createdBookingIds = [];
  const createdUserIds = [];

  let artistId;
  let emptyArtistId;
  let clientId;

  async function createUser(emailPrefix, role, name = null, category = null) {
    const [result] = await pool.execute(
      `INSERT INTO users (email, name, category, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`,
      [
        `${emailPrefix}-${suffix}-${createdUserIds.length}@example.com`,
        name,
        category,
        "test-password-hash",
        role,
      ],
    );
    createdUserIds.push(result.insertId);
    return result.insertId;
  }

  async function createBooking(artistUserId, clientUserId, status, dayOffset) {
    const [result] = await pool.execute(
      `INSERT INTO bookings
         (artist_id, client_id, event_start, event_end, notes, status)
       VALUES (
         ?, ?,
         DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY),
         DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY), INTERVAL 2 HOUR),
         ?, ?
       )`,
      [
        artistUserId,
        clientUserId,
        dayOffset,
        dayOffset,
        `Review test booking offset ${dayOffset}`,
        status,
      ],
    );
    createdBookingIds.push(result.insertId);
    return result.insertId;
  }

  // Reviews store only booking_id; the reviewed artist and the reviewer are
  // derived from the booking (bookings.artist_id / bookings.client_id).
  async function createReview(bookingId, score, comment, createdAt) {
    const [result] = await pool.execute(
      `INSERT INTO reviews
         (booking_id, score, comment, created_at)
       VALUES (?, ?, ?, ?)`,
      [bookingId, score, comment, createdAt],
    );
    createdReviewIds.push(result.insertId);
    return result.insertId;
  }

  beforeAll(async function () {
    artistId = await createUser(
      "review-artist",
      "artist",
      "Elena Vance",
      "Violinist",
    );
    emptyArtistId = await createUser(
      "review-empty-artist",
      "artist",
      "Marco Silva",
      "Cellist",
    );
    clientId = await createUser("review-client", "client");

    // 3 completed bookings (scores 5, 4, 2 -> sum = 11, avg = 3.67)
    // Two of them share the exact same created_at timestamp to verify
    // deterministic secondary ordering by r.id DESC.
    const completedBooking1 = await createBooking(
      artistId,
      clientId,
      "completed",
      30,
    );
    const completedBooking2 = await createBooking(
      artistId,
      clientId,
      "completed",
      20,
    );
    const completedBooking3 = await createBooking(
      artistId,
      clientId,
      "completed",
      10,
    );

    // 1 pending booking and 1 cancelled booking with reviews attached;
    // both must be excluded from list and summary.
    const pendingBooking = await createBooking(
      artistId,
      clientId,
      "pending",
      5,
    );
    const cancelledBooking = await createBooking(
      artistId,
      clientId,
      "cancelled",
      3,
    );

    await createReview(
      completedBooking1,
      5,
      "Oldest completed review",
      "2026-09-01 10:00:00",
    );
    await createReview(
      completedBooking2,
      4,
      "Tied timestamp first insert (lower id)",
      "2026-09-15 12:00:00",
    );
    await createReview(
      completedBooking3,
      2,
      "Tied timestamp second insert (higher id)",
      "2026-09-15 12:00:00",
    );

    await createReview(
      pendingBooking,
      1,
      "Excluded pending booking review",
      "2026-09-20 12:00:00",
    );
    await createReview(
      cancelledBooking,
      1,
      "Excluded cancelled booking review",
      "2026-09-21 12:00:00",
    );
  });

  afterAll(async function () {
    for (const id of createdReviewIds) {
      await pool.execute("DELETE FROM reviews WHERE id = ?", [id]);
    }
    for (const id of createdBookingIds) {
      await pool.execute("DELETE FROM bookings WHERE id = ?", [id]);
    }
    for (const id of createdUserIds) {
      await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    }

    await pool.end();
  });

  it("includes only completed-booking reviews and computes rounded average and distribution", async function () {
    const response = await request(app).get(`/artists/${artistId}/reviews`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.error).toBeNull();

    const { data } = response.body;
    expect(data.artistId).toBe(artistId);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(10);
    expect(data.reviews).toHaveLength(3);

    // Scores: 5, 4, 2 -> 11 / 3 = 3.666... -> 3.67
    expect(data.summary).toEqual({
      averageScore: 3.67,
      totalReviews: 3,
      distribution: {
        1: 0,
        2: 1,
        3: 0,
        4: 1,
        5: 1,
      },
    });

    // Verify newest-first ordering and deterministic tiebreaker (r.id DESC)
    expect(data.reviews.map((r) => r.comment)).toEqual([
      "Tied timestamp second insert (higher id)",
      "Tied timestamp first insert (lower id)",
      "Oldest completed review",
    ]);
  });

  it("paginates eligible reviews while keeping full summary across pages", async function () {
    const page1 = await request(app)
      .get(`/artists/${artistId}/reviews`)
      .query({ page: 1, limit: 2 });

    expect(page1.status).toBe(200);
    expect(page1.body.data.page).toBe(1);
    expect(page1.body.data.limit).toBe(2);
    expect(page1.body.data.reviews).toHaveLength(2);
    expect(page1.body.data.reviews.map((r) => r.comment)).toEqual([
      "Tied timestamp second insert (higher id)",
      "Tied timestamp first insert (lower id)",
    ]);
    expect(page1.body.data.summary.totalReviews).toBe(3);

    const page2 = await request(app)
      .get(`/artists/${artistId}/reviews`)
      .query({ page: 2, limit: 2 });

    expect(page2.status).toBe(200);
    expect(page2.body.data.page).toBe(2);
    expect(page2.body.data.limit).toBe(2);
    expect(page2.body.data.reviews).toHaveLength(1);
    expect(page2.body.data.reviews[0].comment).toBe("Oldest completed review");
    expect(page2.body.data.summary.totalReviews).toBe(3);
  });

  it("returns zero-valued summary and empty list when artist has no eligible reviews", async function () {
    const response = await request(app).get(
      `/artists/${emptyArtistId}/reviews`,
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      artistId: emptyArtistId,
      page: 1,
      limit: 10,
      reviews: [],
      summary: {
        averageScore: 0,
        totalReviews: 0,
        distribution: {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0,
        },
      },
    });
  });

  it("returns 400 for invalid page, limit, or artist ID parameters", async function () {
    const badPage = await request(app)
      .get(`/artists/${artistId}/reviews`)
      .query({ page: 0 });
    expect(badPage.status).toBe(400);
    expect(badPage.body.success).toBe(false);

    const badLimit = await request(app)
      .get(`/artists/${artistId}/reviews`)
      .query({ limit: 101 });
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.success).toBe(false);

    const badArtistId = await request(app).get("/artists/not-a-number/reviews");
    expect(badArtistId.status).toBe(400);
    expect(badArtistId.body.success).toBe(false);
  });

  it("returns 404 when the artist does not exist or user is a client", async function () {
    const missing = await request(app).get("/artists/99999999/reviews");
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);
    expect(missing.body.error).toBe("Artist not found");

    const clientAsArtist = await request(app).get(
      `/artists/${clientId}/reviews`,
    );
    expect(clientAsArtist.status).toBe(404);
    expect(clientAsArtist.body.success).toBe(false);
  });
});
