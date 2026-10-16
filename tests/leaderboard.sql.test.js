const fs = require("fs");
const path = require("path");
const pool = require("../src/config/mysql");

describe("Task 3A Leaderboard SQL query", function () {
  const suffix = `${process.pid}-${Date.now()}`;
  const leaderboardSql = fs.readFileSync(
    path.resolve(__dirname, "../sql/task3_leaderboard.sql"),
    "utf8",
  );

  const createdReviewIds = [];
  const createdBookingIds = [];
  const createdUserIds = [];

  let artistHighAvgId;
  let artistTiedMoreBookingsId;
  let artistTiedFewerBookingsId;
  let artistOnlyFourReviewsId;
  let artistOldReviewsId;
  let clientWithReviewsId;
  let clientReviewerId;

  async function insertUser(emailPrefix, role, name, category) {
    const [result] = await pool.execute(
      `INSERT INTO users (email, name, category, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`,
      [
        `${emailPrefix}-${suffix}-${createdUserIds.length}@example.com`,
        name,
        category,
        "leaderboard-test-hash",
        role,
      ],
    );
    createdUserIds.push(result.insertId);
    return result.insertId;
  }

  async function insertBooking(
    artistId,
    clientId,
    status = "completed",
    daysAgo = 30,
  ) {
    const [result] = await pool.execute(
      `INSERT INTO bookings
         (artist_id, client_id, event_start, event_end, notes, status)
       VALUES (
         ?, ?,
         DATE_SUB(NOW(), INTERVAL ? DAY),
         DATE_ADD(DATE_SUB(NOW(), INTERVAL ? DAY), INTERVAL 2 HOUR),
         ?, ?
       )`,
      [
        artistId,
        clientId,
        daysAgo,
        daysAgo,
        `Leaderboard test booking ${createdBookingIds.length}`,
        status,
      ],
    );
    createdBookingIds.push(result.insertId);
    return result.insertId;
  }

  // Reviews store only booking_id; the reviewed artist is derived from the
  // booking (bookings.artist_id) by the leaderboard query.
  async function insertReview(bookingId, score, daysAgo) {
    const [result] = await pool.execute(
      `INSERT INTO reviews
         (booking_id, score, comment, created_at)
       VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [bookingId, score, `Leaderboard review score ${score}`, daysAgo],
    );
    createdReviewIds.push(result.insertId);
    return result.insertId;
  }

  beforeAll(async function () {
    clientReviewerId = await insertUser(
      "lb-reviewer-client",
      "client",
      null,
      null,
    );

    // 1. Artist with 5 recent reviews, highest average: [5, 5, 5, 5, 4] -> avg 4.80, 5 completed bookings
    artistHighAvgId = await insertUser(
      "lb-artist-high",
      "artist",
      "Aria Sterling",
      "Pianist",
    );
    for (const score of [5, 5, 5, 5, 4]) {
      const bId = await insertBooking(
        artistHighAvgId,
        clientReviewerId,
        "completed",
        15,
      );
      await insertReview(bId, score, 10);
    }

    // 2. Artist with 5 recent reviews, tied average 4.40 ([5, 5, 4, 4, 4]),
    //    PLUS 2 extra unreviewed completed bookings -> 7 completed bookings total
    //    (also tests that joining 5 reviews x 7 bookings does not inflate total_completed_bookings to 35).
    artistTiedMoreBookingsId = await insertUser(
      "lb-artist-tied-more",
      "artist",
      "Devon Brooks",
      "Drummer",
    );
    for (const score of [5, 5, 4, 4, 4]) {
      const bId = await insertBooking(
        artistTiedMoreBookingsId,
        clientReviewerId,
        "completed",
        20,
      );
      await insertReview(bId, score, 12);
    }
    await insertBooking(
      artistTiedMoreBookingsId,
      clientReviewerId,
      "completed",
      25,
    );
    await insertBooking(
      artistTiedMoreBookingsId,
      clientReviewerId,
      "completed",
      26,
    );

    // 3. Artist with 5 recent reviews, tied average 4.40 ([5, 5, 4, 4, 4]),
    //    and exactly 5 completed bookings (+ 1 cancelled booking that must not count).
    artistTiedFewerBookingsId = await insertUser(
      "lb-artist-tied-fewer",
      "artist",
      "Clara Chen",
      "Flutist",
    );
    for (const score of [5, 5, 4, 4, 4]) {
      const bId = await insertBooking(
        artistTiedFewerBookingsId,
        clientReviewerId,
        "completed",
        18,
      );
      await insertReview(bId, score, 14);
    }
    await insertBooking(
      artistTiedFewerBookingsId,
      clientReviewerId,
      "cancelled",
      19,
    );

    // 4. Artist with only 4 recent reviews -> must be excluded by HAVING COUNT(*) >= 5
    artistOnlyFourReviewsId = await insertUser(
      "lb-artist-four",
      "artist",
      "Nolan Price",
      "Saxophonist",
    );
    for (const score of [5, 5, 5, 5]) {
      const bId = await insertBooking(
        artistOnlyFourReviewsId,
        clientReviewerId,
        "completed",
        10,
      );
      await insertReview(bId, score, 8);
    }

    // 5. Artist with 4 recent reviews (score 5) and 2 reviews older than 90 days (100 days ago, score 1)
    //    -> only 4 reviews fall in the 90-day window, so must be excluded; also proves >90d reviews do not count.
    artistOldReviewsId = await insertUser(
      "lb-artist-old",
      "artist",
      "Sora Takahashi",
      "Harpist",
    );
    for (const score of [5, 5, 5, 5]) {
      const bId = await insertBooking(
        artistOldReviewsId,
        clientReviewerId,
        "completed",
        20,
      );
      await insertReview(bId, score, 15);
    }
    for (const score of [1, 1]) {
      const bId = await insertBooking(
        artistOldReviewsId,
        clientReviewerId,
        "completed",
        120,
      );
      await insertReview(bId, score, 100);
    }

    // 6. User with role = 'client' who is set as the artist_id of 5 completed,
    //    reviewed bookings (bad data). The leaderboard derives the artist from
    //    bookings.artist_id, so this client would otherwise aggregate onto the
    //    board -> must be excluded by WHERE u.role = 'artist'.
    clientWithReviewsId = await insertUser(
      "lb-non-artist-client",
      "client",
      "Client Pretending Artist",
      "None",
    );
    for (const score of [5, 5, 5, 5, 5]) {
      const bId = await insertBooking(
        clientWithReviewsId,
        clientReviewerId,
        "completed",
        10,
      );
      await insertReview(bId, score, 5);
    }
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

  it("enforces the 5-review 90-day threshold, excludes clients, avoids join inflation, and orders by avg score then completed bookings", async function () {
    const [rows] = await pool.query(leaderboardSql);

    const returnedIds = rows.map((r) => r.artist_id);

    // Excluded candidates must not appear
    expect(returnedIds).not.toContain(artistOnlyFourReviewsId);
    expect(returnedIds).not.toContain(artistOldReviewsId);
    expect(returnedIds).not.toContain(clientWithReviewsId);

    // Filter to the fixtures created in this suite in their returned order
    const suiteRows = rows.filter((r) =>
      [
        artistHighAvgId,
        artistTiedMoreBookingsId,
        artistTiedFewerBookingsId,
      ].includes(r.artist_id),
    );

    expect(suiteRows).toHaveLength(3);

    // 1st: Aria Sterling (avg 4.80, 5 reviews, 5 completed bookings)
    expect(suiteRows[0]).toEqual({
      artist_id: artistHighAvgId,
      artist_name: "Aria Sterling",
      category: "Pianist",
      average_score: "4.80",
      total_reviews: 5,
      total_completed_bookings: 5,
    });

    // 2nd: Devon Brooks (avg 4.40, 5 reviews, 7 completed bookings -- not inflated to 35)
    expect(suiteRows[1]).toEqual({
      artist_id: artistTiedMoreBookingsId,
      artist_name: "Devon Brooks",
      category: "Drummer",
      average_score: "4.40",
      total_reviews: 5,
      total_completed_bookings: 7,
    });

    // 3rd: Clara Chen (avg 4.40, 5 reviews, 5 completed bookings -- tiebreaker places her after Devon)
    expect(suiteRows[2]).toEqual({
      artist_id: artistTiedFewerBookingsId,
      artist_name: "Clara Chen",
      category: "Flutist",
      average_score: "4.40",
      total_reviews: 5,
      total_completed_bookings: 5,
    });
  });
});
