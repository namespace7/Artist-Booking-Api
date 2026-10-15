const pool = require("../config/mysql");

module.exports = {
  async findConfirmedOverlap(connection, artistId, eventStart, eventEnd) {
    const [rows] = await connection.execute(
      `SELECT id
       FROM bookings
       WHERE artist_id = ?
         AND status = 'confirmed'
         AND event_start < ?
         AND event_end > ?
       LIMIT 1`,
      [artistId, eventEnd, eventStart],
    );

    return rows.length > 0;
  },

  async create(connection, booking) {
    const [result] = await connection.execute(
      `INSERT INTO bookings
         (artist_id, client_id, event_start, event_end, notes, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        booking.artistId,
        booking.clientId,
        booking.eventStart,
        booking.eventEnd,
        booking.notes,
      ],
    );

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

  async findById(connection, bookingId) {
    const [rows] = await connection.execute(
      `SELECT id, artist_id, client_id, event_start, event_end, notes, status
       FROM bookings
       WHERE id = ?
       FOR UPDATE`,
      [bookingId],
    );

    return rows.length > 0 ? rows[0] : null;
  },

  async updateStatus(connection, bookingId, status) {
    await connection.execute("UPDATE bookings SET status = ? WHERE id = ?", [
      status,
      bookingId,
    ]);
  },
};
