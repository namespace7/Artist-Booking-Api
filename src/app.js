const express = require("express");

const app = express();

// Parse incoming JSON request bodies.
app.use(express.json());

// Health-check endpoint.
app.get("/health", function (req, res) {
  res.status(200).json({
    success: true,
    data: {
      status: "healthy",
    },
  });
});

module.exports = app;
