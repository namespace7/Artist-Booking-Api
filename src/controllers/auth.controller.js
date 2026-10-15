const authService = require("../services/auth.service");

module.exports = {
  async login(req, res, next) {
    try {
      const email = req.body && req.body.email;
      const password = req.body && req.body.password;

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          data: null,
          error: "Email and password are required",
        });
      }

      const result = await authService.login(email.trim(), password);

      if (!result) {
        return res.status(401).json({
          success: false,
          data: null,
          error: "Invalid email or password",
        });
      }

      return res.status(200).json({ success: true, data: result, error: null });
    } catch (error) {
      next(error);
    }
  },
};
