const express = require("express");
const authRouter = require("./routes/auth.routes");

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

app.use("/auth", authRouter);

module.exports = app;
