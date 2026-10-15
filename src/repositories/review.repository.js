const Review = require("../models/review.model");

function emptyDistribution() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

module.exports = {
  async findEligibleForArtist(artistId, bookingIds, skip, limit) {
    if (bookingIds.length === 0) {
      return [];
    }

    return Review.find({
      artistId,
      bookingId: { $in: bookingIds },
    })
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .select("bookingId clientId score comment createdAt")
      .lean();
  },

  async summarizeEligibleForArtist(artistId, bookingIds) {
    if (bookingIds.length === 0) {
      return {
        averageScore: 0,
        totalReviews: 0,
        distribution: emptyDistribution(),
      };
    }

    const [result] = await Review.aggregate([
      {
        $match: {
          artistId,
          bookingId: { $in: bookingIds },
        },
      },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$score" },
          totalReviews: { $sum: 1 },
          counts: {
            $push: "$score",
          },
        },
      },
      {
        $project: {
          _id: 0,
          averageScore: 1,
          totalReviews: 1,
          distribution: {
            $arrayToObject: {
              $map: {
                input: [1, 2, 3, 4, 5],
                as: "score",
                in: {
                  k: { $toString: "$$score" },
                  v: {
                    $size: {
                      $filter: {
                        input: "$counts",
                        as: "existingScore",
                        cond: {
                          $eq: ["$$existingScore", "$$score"],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ]);

    if (!result) {
      return {
        averageScore: 0,
        totalReviews: 0,
        distribution: emptyDistribution(),
      };
    }

    return {
      averageScore: Number(result.averageScore.toFixed(2)),
      totalReviews: result.totalReviews,
      distribution: result.distribution,
    };
  },
};
