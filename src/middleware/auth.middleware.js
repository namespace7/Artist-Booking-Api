const jwt = require("jsonwebtoken");

module.exports = {
  authenticateToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        data: null,
        error: "Authentication token required",
      });
    }

    const token = authorization.slice(7);

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        data: null,
        error: "Authentication is not configured",
      });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload.userId || !["artist", "client"].includes(payload.role)) {
        return res.status(401).json({
          success: false,
          data: null,
          error: "Invalid authentication token",
        });
      }

      req.user = {
        id: payload.userId,
        role: payload.role,
      };

      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        data: null,
        error: "Invalid or expired authentication token",
      });
    }
  },
};
