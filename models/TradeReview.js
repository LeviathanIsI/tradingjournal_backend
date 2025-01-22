const mongoose = require("mongoose");

const tradeReviewSchema = new mongoose.Schema(
  {
    trade: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lessonLearned: String,
    whatWentWell: String,
    whatWentWrong: String,
    futureAdjustments: String,
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TradeReview", tradeReviewSchema);
