const TradeReview = require("../models/TradeReview");
const moment = require("moment-timezone");

const updateFeaturedReviews = async () => {
  try {
    const now = moment().tz("America/New_York");
    const isWeekend = now.day() === 0 || now.day() === 6;
    const isMonday = now.day() === 1;

    if (isWeekend) return;

    const estYesterday = now.subtract(1, "day");
    const startOfDay = estYesterday.startOf("day").toDate();
    const endOfDay = estYesterday.endOf("day").toDate();

    // Enhanced aggregation pipeline for top reviews
    const topReviews = await TradeReview.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          isPublic: true,
        },
      },
      // Lookup trade data
      {
        $lookup: {
          from: "trades",
          localField: "trade",
          foreignField: "_id",
          as: "tradeData",
        },
      },
      {
        $unwind: "$tradeData",
      },
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ["$likes", []] } },
          commentsCount: { $size: { $ifNull: ["$comments", []] } },
          // Calculate content score based on length and key fields
          contentScore: {
            $add: [
              { $strLenCP: { $ifNull: ["$content", ""] } },
              {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ["$mistakes", ""] } }, 0] },
                  50,
                  0,
                ],
              },
              {
                $cond: [
                  {
                    $gt: [
                      { $strLenCP: { $ifNull: ["$lessonsLearned", ""] } },
                      0,
                    ],
                  },
                  50,
                  0,
                ],
              },
              {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ["$strategy", ""] } }, 0] },
                  30,
                  0,
                ],
              },
            ],
          },
          // Flag if trade was profitable
          isProfitable: { $gt: ["$tradeData.profitLoss.realized", 0] },
        },
      },
      {
        $addFields: {
          // Calculate total score with weighted components
          totalScore: {
            $add: [
              { $multiply: ["$likesCount", 10] }, // Likes weight
              { $multiply: ["$commentsCount", 5] }, // Comments weight
              { $divide: ["$contentScore", 100] }, // Content length & quality weight
              { $cond: ["$isProfitable", 20, 0] }, // Profitable trade bonus
            ],
          },
        },
      },
      {
        $sort: { totalScore: -1 },
      },
    ]);

    // If it's Monday and we have no new reviews, keep weekend reviews
    if (isMonday && topReviews.length === 0) return;

    // Reset current featured reviews
    await TradeReview.updateMany({}, { featured: false });

    let featuredReviews = [...topReviews];

    // Enhanced fallback for not enough reviews
    if (topReviews.length < 5) {
      const remaining = 5 - topReviews.length;
      const fallbackReviews = await TradeReview.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDay, $lte: endOfDay },
            isPublic: true,
            _id: { $nin: topReviews.map((r) => r._id) },
          },
        },
        {
          $lookup: {
            from: "trades",
            localField: "trade",
            foreignField: "_id",
            as: "tradeData",
          },
        },
        {
          $unwind: "$tradeData",
        },
        {
          $addFields: {
            contentScore: {
              $add: [
                { $strLenCP: { $ifNull: ["$content", ""] } },
                {
                  $cond: [
                    { $gt: [{ $strLenCP: { $ifNull: ["$mistakes", ""] } }, 0] },
                    50,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $gt: [
                        { $strLenCP: { $ifNull: ["$lessonsLearned", ""] } },
                        0,
                      ],
                    },
                    50,
                    0,
                  ],
                },
              ],
            },
            isProfitable: { $gt: ["$tradeData.profitLoss.realized", 0] },
          },
        },
        {
          $match: {
            $or: [
              { isProfitable: true },
              { contentScore: { $gt: 100 } }, // Minimum content quality threshold
            ],
          },
        },
        { $sample: { size: remaining } },
      ]);

      featuredReviews = [...topReviews, ...fallbackReviews];
    } else {
      featuredReviews = topReviews.slice(0, 5);
    }

    // Update featured status
    if (featuredReviews.length > 0) {
      await TradeReview.updateMany(
        { _id: { $in: featuredReviews.map((review) => review._id) } },
        { featured: true }
      );
    }

    return featuredReviews;
  } catch (error) {
    console.error("Error updating featured reviews:", error);
    throw error;
  }
};

const checkAndUpdateFeatured = async () => {
  const featuredCount = await TradeReview.countDocuments({ featured: true });
  if (featuredCount === 0) {
    await updateFeaturedReviews();
  }
};

module.exports = {
  updateFeaturedReviews,
  checkAndUpdateFeatured,
};
