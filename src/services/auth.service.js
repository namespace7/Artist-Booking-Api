const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/user.repository");

module.exports = {
  async login(email, password) {
    const user = await userRepository.findByEmail(email);

    // Use the same error for an unknown email and a wrong password.
    if (!user) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return null;
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      },
    );

    return { token, user: { id: user.id, email: user.email, role: user.role } };
  },
};
