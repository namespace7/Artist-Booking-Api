const pool = require("../config/mysql");
const reviewRepository = require("../repositories/review.repository");

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

    const [artists] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND role = ?",
      [artistId, "artist"],
    );

    if (artists.length === 0) {
      throw new ReviewError(404, "Artist not found");
    }

    // MySQL owns booking state. Only completed bookings qualify.
    const [bookings] = await pool.execute(
      `SELECT id
       FROM bookings
       WHERE artist_id = ? AND status = 'completed'`,
      [artistId],
    );

    const bookingIds = bookings.map(function (booking) {
      return booking.id;
    });

    const skip = (page - 1) * limit;

    const [reviews, summary] = await Promise.all([
      reviewRepository.findEligibleForArtist(artistId, bookingIds, skip, limit),
      reviewRepository.summarizeEligibleForArtist(artistId, bookingIds),
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
