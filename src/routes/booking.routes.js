const express = require("express");
const bookingController = require("../controllers/booking.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/", authenticateToken, bookingController.create);
router.patch("/:id/status", authenticateToken, bookingController.updateStatus);

module.exports = router;
