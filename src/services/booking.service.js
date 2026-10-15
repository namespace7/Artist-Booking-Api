const pool = require("../config/mysql");
const bookingRepository = require("../repositories/booking.repository");

const transitions = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};

class BookingError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function parseDate(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BookingError(400, fieldName + " is required");
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BookingError(400, fieldName + " must be a valid date");
  }

  return parsed;
}

module.exports = {
  BookingError,

  async createBooking(user, input) {
    if (user.role !== "client") {
      throw new BookingError(403, "Only clients can create bookings");
    }

    const artistId = Number(input.artist_id);

    if (!Number.isSafeInteger(artistId) || artistId <= 0) {
      throw new BookingError(400, "artist_id must be a positive integer");
    }

    if (typeof input.notes !== "string" || !input.notes.trim()) {
      throw new BookingError(400, "notes is required");
    }

    const eventStart = parseDate(input.event_start, "event_start");
    const eventEnd = parseDate(input.event_end, "event_end");

    if (eventStart <= new Date()) {
      throw new BookingError(422, "event_start must be in the future");
    }

    if (eventEnd <= eventStart) {
      throw new BookingError(422, "event_end must be after event_start");
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Lock the artist row so simultaneous booking attempts for the same
      // artist are serialized while the overlap check and insert run.
      const [artists] = await connection.execute(
        "SELECT id, role FROM users WHERE id = ? FOR UPDATE",
        [artistId],
      );

      if (artists.length === 0 || artists[0].role !== "artist") {
        throw new BookingError(404, "Artist not found");
      }

      const hasOverlap = await bookingRepository.findConfirmedOverlap(
        connection,
        artistId,
        eventStart,
        eventEnd,
      );

      if (hasOverlap) {
        throw new BookingError(
          409,
          "Artist already has a confirmed booking during this time",
        );
      }

      const booking = await bookingRepository.create(connection, {
        artistId,
        clientId: user.id,
        eventStart,
        eventEnd,
        notes: input.notes.trim(),
      });

      await connection.commit();
      return booking;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async updateStatus(user, bookingId, newStatus) {
    const id = Number(bookingId);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new BookingError(400, "Booking ID must be a positive integer");
    }

    if (
      typeof newStatus !== "string" ||
      !Object.prototype.hasOwnProperty.call(transitions, newStatus)
    ) {
      throw new BookingError(422, "Invalid booking status");
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const booking = await bookingRepository.findById(connection, id);

      if (!booking) {
        throw new BookingError(404, "Booking not found");
      }

      const isArtist = user.role === "artist";
      const isClient = user.role === "client";

      if (isArtist && booking.artist_id !== user.id) {
        throw new BookingError(
          403,
          "You cannot update another artist’s booking",
        );
      }

      if (isClient && booking.client_id !== user.id) {
        throw new BookingError(
          403,
          "You cannot update another client’s booking",
        );
      }

      if (!isArtist && !isClient) {
        throw new BookingError(403, "Role is not permitted to update bookings");
      }

      if (isClient && newStatus !== "cancelled") {
        throw new BookingError(403, "Clients can only cancel bookings");
      }

      if (!transitions[booking.status].includes(newStatus)) {
        throw new BookingError(
          422,
          "Cannot transition booking from " +
            booking.status +
            " to " +
            newStatus,
        );
      }

      await bookingRepository.updateStatus(connection, id, newStatus);
      await connection.commit();

      return {
        id: booking.id,
        status: newStatus,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
