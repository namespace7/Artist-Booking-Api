const express = require("express");
const reviewController = require("../controllers/review.controller");

const router = express.Router();

router.get("/:id/reviews", reviewController.listForArtist);

module.exports = router;
