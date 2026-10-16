const bookingService = require("../services/booking.service");

function handleError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      data: null,
      error: error.message,
    });
  }

  return next(error);
}

module.exports = {
  async create(req, res, next) {
    try {
      const booking = await bookingService.createBooking(
        req.user,
        req.body || {},
        req.get("Idempotency-Key"),
      );

      return res.status(201).json({
        success: true,
        data: booking,
        error: null,
      });
    } catch (error) {
      return handleError(error, res, next);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const booking = await bookingService.updateStatus(
        req.user,
        req.params.id,
        req.body && req.body.status,
      );

      return res.status(200).json({
        success: true,
        data: booking,
        error: null,
      });
    } catch (error) {
      return handleError(error, res, next);
    }
  },
};
