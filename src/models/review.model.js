const { mongoose } = require("../config/mongo");

const reviewSchema = new mongoose.Schema(
  {
    bookingId: { type: Number, required: true},
    artistId: { type: Number, required: true, index: true },
    clientId: { type: Number, required: true },

    score: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "score must be an integer from 1 to 5",
      },
    },

    comment: {
      type: String,
      default: "",
      maxlength: 5000,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "reviews",
  },
);

// Assumption: at most one review per booking.
reviewSchema.index({ bookingId: 1 }, { unique: true });
reviewSchema.index({ artistId: 1, createdAt: -1 });

module.exports =
  mongoose.models.Review || mongoose.model("Review", reviewSchema);
