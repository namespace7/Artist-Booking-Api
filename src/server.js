require("dotenv").config();

const app = require("./app");
const { connectMongo } = require("./config/mongo");

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectMongo();
    app.listen(PORT, function () {
      console.log("Server is running on port " + PORT);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();
