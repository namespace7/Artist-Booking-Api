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

module.exports = {
  // Find the artist associated with a booking before locking it.
  async findArtistIdForBooking(bookingId) {
    const sql = "SELECT artist_id FROM bookings WHERE id = ?";
    const params = [bookingId];

    logSql("findArtistIdForBooking", sql, params);

    const [rows] = await pool.execute(sql, params);

    return rows.length > 0 ? rows[0].artist_id : null;
  },

  // Find an existing operation for this client and idempotency key.
  async findByIdempotencyKey(connection, clientId, idempotencyKey) {
    const sql = `
      SELECT id, idempotency_request_hash, idempotency_response
      FROM bookings
      WHERE client_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `;

    const params = [clientId, idempotencyKey];

    logSql("findByIdempotencyKey", sql, params);

    const [rows] = await connection.execute(sql, params);

    return rows.length > 0 ? rows[0] : null;
  },

  // Check whether a confirmed booking overlaps the requested time.
  async findConfirmedOverlap(connection, artistId, eventStart, eventEnd) {
    const sql = `
      SELECT id
      FROM bookings
      WHERE artist_id = ?
        AND status = 'confirmed'
        AND event_start < ?
        AND event_end > ?
      LIMIT 1
    `;

    const params = [artistId, eventEnd, eventStart];

    logSql("findConfirmedOverlap", sql, params);

    const [rows] = await connection.execute(sql, params);

    return rows.length > 0;
  },

  // Create a pending booking and associate its idempotency key.
  async create(connection, booking) {
    const sql = `
      INSERT INTO bookings (
        artist_id,
        client_id,
        event_start,
        event_end,
        notes,
        idempotency_key,
        idempotency_request_hash,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const params = [
      booking.artistId,
      booking.clientId,
      booking.eventStart,
      booking.eventEnd,
      booking.notes,
      booking.idempotencyKey,
      booking.requestHash,
    ];

    logSql("create", sql, params);

    const [result] = await connection.execute(sql, params);

    return {
      id: result.insertId,
      artistId: booking.artistId,
      clientId: booking.clientId,
      eventStart: booking.eventStart,
      eventEnd: booking.eventEnd,
      notes: booking.notes,
      status: "pending",
    };
  },

  // Save the original successful response for future retries.
  async saveIdempotencyResponse(connection, bookingId, response) {
    const sql = `
      UPDATE bookings
      SET idempotency_response = ?
      WHERE id = ?
    `;

    const params = [JSON.stringify(response), bookingId];

    logSql("saveIdempotencyResponse", sql, params);

    await connection.execute(sql, params);
  },

  async findById(connection, bookingId) {
    const sql = `
      SELECT id, artist_id, client_id, event_start, event_end, notes, status
      FROM bookings
      WHERE id = ?
      FOR UPDATE
    `;

    const params = [bookingId];

    logSql("findById", sql, params);

    const [rows] = await connection.execute(sql, params);

    return rows.length > 0 ? rows[0] : null;
  },

  async updateStatus(connection, bookingId, status) {
    const sql = "UPDATE bookings SET status = ? WHERE id = ?";
    const params = [status, bookingId];

    logSql("updateStatus", sql, params);

    await connection.execute(sql, params);
  },
};
