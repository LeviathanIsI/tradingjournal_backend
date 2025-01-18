// backend/models/TradePlan.js
const mongoose = require("mongoose");

const tradePlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ticker: {
      type: String,
      required: true,
      uppercase: true,
    },
    direction: {
      type: String,
      enum: ["LONG", "SHORT", "SWING"],
      required: true,
    },
    // Trade Attributes
    attributes: {
      lowFloat: { type: Boolean, default: false },
      upMoreThan10Percent: { type: Boolean, default: false },
      unusualVolume: { type: Boolean, default: false },
      formerRunner: { type: Boolean, default: false },
      hasCatalyst: { type: Boolean, default: false },
      wholeHalfDollarBreak: { type: Boolean, default: false },
      clearSupport: { type: Boolean, default: false },
    },
    // Quality Metrics
    quality: {
      float: { type: Number, default: null },
      supportArea: { type: String, default: null },
      catalystRating: { type: Number, default: null },
    },
    // Setup Details
    setup: {
      entry: {
        price: { type: Number, default: null },
        description: { type: String, default: null },
      },
      setupGrade: {
        type: String,
        enum: ["A+", "A", "B", "C", "D", "F"],
        default: null,
      },
    },
    // Execution Plan
    execution: {
      entry: { type: Number, default: null },
      profitTarget: { type: Number, default: null },
      stopLoss: { type: Number, default: null },
    },
    // Risk Management
    riskManagement: {
      positionSize: { type: Number, default: null },
      riskAmount: { type: Number, default: null },
      riskPercent: { type: Number, default: null },
      rewardRatio: { type: Number, default: null },
    },
    notes: { type: String, default: null },
    status: {
      type: String,
      enum: ["PLANNED", "EXECUTED", "CANCELLED"],
      default: "PLANNED",
    },
  },
  {
    timestamps: true,
  }
);

// Calculate risk/reward metrics before saving (only if both values exist)
tradePlanSchema.pre("save", function (next) {
  if (
    this.execution.entry &&
    this.execution.stopLoss &&
    this.execution.profitTarget
  ) {
    const riskPerShare = Math.abs(
      this.execution.entry - this.execution.stopLoss
    );
    const potentialReward = Math.abs(
      this.execution.profitTarget - this.execution.entry
    );
    this.riskManagement.rewardRatio = potentialReward / riskPerShare;
  }
  next();
});

const TradePlan = mongoose.model("TradePlan", tradePlanSchema);
module.exports = TradePlan;
