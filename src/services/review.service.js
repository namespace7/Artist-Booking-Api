const pool = require("../config/mysql");
const mysql = require("mysql2");
const reviewRepository = require("../repositories/review.repository");

const DEBUG_SQL = process.env.DEBUG_SQL === "true";

function logSql(label, sql, params) {
  if (!DEBUG_SQL) {
    return;
  }

  console.debug(`\n[SQL DEBUG] ${label}\n${mysql.format(sql, params)}\n`);
}

class ReviewError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = {
  ReviewError,

  async getArtistReviews(idValue, query) {
    const artistId = Number(idValue);

    if (!Number.isSafeInteger(artistId) || artistId <= 0) {
      throw new ReviewError(400, "Artist ID must be a positive integer");
    }

    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? 10 : Number(query.limit);

    if (!Number.isSafeInteger(page) || page < 1) {
      throw new ReviewError(400, "page must be a positive integer");
    }

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ReviewError(400, "limit must be an integer between 1 and 100");
    }

    // Verify that the requested user exists and has the artist role.
    const artistSql = "SELECT id FROM users WHERE id = ? AND role = ?";
    const artistParams = [artistId, "artist"];

    logSql("getArtistReviews: verify artist", artistSql, artistParams);

    const [artists] = await pool.execute(artistSql, artistParams);

    if (artists.length === 0) {
      throw new ReviewError(404, "Artist not found");
    }

    // The repository queries only reviews associated with completed bookings.
    const offset = (page - 1) * limit;

    const [reviews, summary] = await Promise.all([
      reviewRepository.findEligibleForArtist(artistId, limit, offset),
      reviewRepository.summarizeEligibleForArtist(artistId),
    ]);

    return {
      artistId,
      page,
      limit,
      reviews,
      summary,
    };
  },
};
