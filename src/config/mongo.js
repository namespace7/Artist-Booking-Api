const mongoose = require('mongoose');

async function connectMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(process.env.MONGO_URI);
  return mongoose.connection;
}

module.exports = { connectMongo, mongoose };