const pool = require("../config/mysql");

module.exports = {
  async findByEmail(email) {
    const [rows] = await pool.execute(
      "SELECT id, email, password_hash, role from users WHERE email = ?",
      [email],
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  },
};
