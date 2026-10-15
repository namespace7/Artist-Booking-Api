const reviewService = require("../services/review.service");

module.exports = {
  async listForArtist(req, res, next) {
    try {
      const result = await reviewService.getArtistReviews(
        req.params.id,
        req.query,
      );

      return res.status(200).json({
        success: true,
        data: result,
        error: null,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          data: null,
          error: error.message,
        });
      }

      return next(error);
    }
  },
};
