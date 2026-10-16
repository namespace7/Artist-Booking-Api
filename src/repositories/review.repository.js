const pool = require("../config/mysql");
const mysql = require("mysql2");

// Enable SQL debugging only when DEBUG_SQL=true.
const DEBUG_SQL = process.env.DEBUG_SQL === "true";

function logSql(label, sql, params) {
  if (!DEBUG_SQL) {
    return;
  }

  console.debug(`\n[SQL DEBUG] ${label}\n${mysql.format(sql, params)}\n`);
}

function emptyDistribution() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

module.exports = {
  // Returns paginated reviews for an artist whose bookings are completed.
  async findEligibleForArtist(artistId, limit, offset) {
    const sql = `
      SELECT
        r.booking_id AS bookingId,
        b.client_id AS clientId,
        r.score,
        r.comment,
        r.created_at AS createdAt
      FROM reviews r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.artist_id = ? AND b.status = 'completed'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `;

    const params = [artistId, limit, offset];

    logSql("findEligibleForArtist", sql, params);

    const [rows] = await pool.execute(sql, params);

    return rows;
  },

  // Calculates the summary for the same eligible reviews as above.
  async summarizeEligibleForArtist(artistId) {
    const sql = `
      SELECT
        COUNT(*) AS totalReviews,
        AVG(r.score) AS averageScore,
        SUM(r.score = 1) AS score1,
        SUM(r.score = 2) AS score2,
        SUM(r.score = 3) AS score3,
        SUM(r.score = 4) AS score4,
        SUM(r.score = 5) AS score5
      FROM reviews r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.artist_id = ? AND b.status = 'completed'
    `;

    const params = [artistId];

    logSql("summarizeEligibleForArtist", sql, params);

    const [[row]] = await pool.execute(sql, params);

    const totalReviews = Number(row.totalReviews);

    if (totalReviews === 0) {
      return {
        averageScore: 0,
        totalReviews: 0,
        distribution: emptyDistribution(),
      };
    }

    return {
      averageScore: Number(Number(row.averageScore).toFixed(2)),
      totalReviews,
      distribution: {
        1: Number(row.score1),
        2: Number(row.score2),
        3: Number(row.score3),
        4: Number(row.score4),
        5: Number(row.score5),
      },
    };
  },
};
