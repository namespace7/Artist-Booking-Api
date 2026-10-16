const pool = require("../config/mysql");
const mysql = require("mysql2");
const bookingRepository = require("../repositories/booking.repository");
const crypto = require("crypto");

const DEBUG_SQL = process.env.DEBUG_SQL === "true";

function logSql(label, sql, params) {
  if (!DEBUG_SQL) {
    return;
  }

  console.debug(`\n[SQL DEBUG] ${label}\n${mysql.format(sql, params)}\n`);
}

// Allowed booking status transitions.
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

function createRequestHash(booking) {
  const canonicalRequest = {
    artistId: booking.artistId,
    eventStart: booking.eventStart.toISOString(),
    eventEnd: booking.eventEnd.toISOString(),
    notes: booking.notes,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

function getExistingResponse(existing, requestHash) {
  if (existing.idempotency_request_hash !== requestHash) {
    throw new BookingError(
      409,
      "Idempotency-Key has already been used with a different request",
    );
  }

  let response = existing.idempotency_response;

  // MySQL drivers can return JSON as an object or a string.
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch (error) {
      throw new BookingError(500, "Saved idempotency response is invalid");
    }
  }

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new BookingError(500, "Saved idempotency response is unavailable");
  }

  return response;
}

module.exports = {
  BookingError,

  async createBooking(user, input, idempotencyKey) {
    if (user.role !== "client") {
      throw new BookingError(403, "Only clients can create bookings");
    }

    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      throw new BookingError(400, "Idempotency-Key header is required");
    }

    idempotencyKey = idempotencyKey.trim();

    if (idempotencyKey.length > 128) {
      throw new BookingError(
        400,
        "Idempotency-Key must not exceed 128 characters",
      );
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
    const notes = input.notes.trim();

    const bookingDetails = {
      artistId,
      eventStart,
      eventEnd,
      notes,
    };

    const requestHash = createRequestHash(bookingDetails);

    // Fast path: return the original result if this key already exists.
    // This also lets a retry succeed after the event start time has passed.
    const previousBooking = await bookingRepository.findByIdempotencyKey(
      pool,
      user.id,
      idempotencyKey,
    );

    if (previousBooking) {
      return getExistingResponse(previousBooking, requestHash);
    }

    // Apply time-based business validations only for a new operation.
    if (eventStart <= new Date()) {
      throw new BookingError(422, "event_start must be in the future");
    }

    if (eventEnd <= eventStart) {
      throw new BookingError(422, "event_end must be after event_start");
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Preserve the artist-first locking strategy.
      const artistSql = "SELECT id, role FROM users WHERE id = ? FOR UPDATE";
      const artistParams = [artistId];

      logSql("createBooking: lock artist", artistSql, artistParams);

      const [artists] = await connection.execute(artistSql, artistParams);

      // Recheck inside the transaction to handle concurrent requests.
      // This is the first ordinary SELECT after acquiring the artist lock.
      const existing = await bookingRepository.findByIdempotencyKey(
        connection,
        user.id,
        idempotencyKey,
      );

      if (existing) {
        const response = getExistingResponse(existing, requestHash);

        await connection.commit();
        return response;
      }

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
        notes,
        idempotencyKey,
        requestHash,
      });

      // Save the exact creation response before committing.
      await bookingRepository.saveIdempotencyResponse(
        connection,
        booking.id,
        booking,
      );

      await connection.commit();

      return booking;
    } catch (error) {
      // A duplicate-key race may happen when concurrent requests target
      // different artists, so the artist lock alone is not sufficient.
      try {
        await connection.rollback();
      } catch (rollbackError) {
        // Preserve the original error if rollback is no longer possible.
      }

      if (error.code === "ER_DUP_ENTRY") {
        const existing = await bookingRepository.findByIdempotencyKey(
          pool,
          user.id,
          idempotencyKey,
        );

        if (existing) {
          return getExistingResponse(existing, requestHash);
        }
      }

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

    // Look up the artist before starting the transaction so we can lock
    // the artist row before the booking row. This lookup is a separate
    // autocommit query, not the authoritative read of booking state.
    const artistIdForLock = await bookingRepository.findArtistIdForBooking(id);

    if (artistIdForLock === null) {
      throw new BookingError(404, "Booking not found");
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Use the same artist-first locking order as createBooking()
      // to coordinate concurrent booking operations for this artist.
      const artistSql = "SELECT id FROM users WHERE id = ? FOR UPDATE";
      const artistParams = [artistIdForLock];

      logSql("updateStatus: lock artist", artistSql, artistParams);

      const [artistRows] = await connection.execute(artistSql, artistParams);

      if (artistRows.length === 0) {
        throw new BookingError(404, "Booking not found");
      }

      // Lock and re-read the booking after acquiring the artist lock.
      // Use this authoritative read for authorization and status checks.
      const booking = await bookingRepository.findById(connection, id);

      if (!booking) {
        throw new BookingError(404, "Booking not found");
      }

      // Verify that the booking still belongs to the artist we locked.
      // This is a defensive check in case the relationship changed.
      if (booking.artist_id !== artistIdForLock) {
        throw new BookingError(
          409,
          "Booking data changed unexpectedly; please retry",
        );
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

      // Only confirming a booking requires another overlap check.
      // This is the first ordinary SELECT in this transaction. Under
      // REPEATABLE READ, its snapshot is established after the locking
      // reads above, so conflicting confirmations committed while this
      // transaction waited for the artist lock are visible.
      if (newStatus === "confirmed") {
        const hasOverlap = await bookingRepository.findConfirmedOverlap(
          connection,
          booking.artist_id,
          booking.event_start,
          booking.event_end,
        );

        if (hasOverlap) {
          throw new BookingError(
            409,
            "Artist already has a confirmed booking during this time",
          );
        }
      }

      await bookingRepository.updateStatus(connection, id, newStatus);
      await connection.commit();

      return {
        id: booking.id,
        status: newStatus,
      };
    } catch (error) {
      // Roll back failed operations and always release the connection.
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
