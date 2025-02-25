const mongoose = require("mongoose");

const optionTradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Underlying stock details
    symbol: {
      type: String,
      required: [true, "Symbol is required"],
      uppercase: true,
      trim: true,
    },
    underlyingPrice: {
      type: Number,
      required: [true, "Underlying price is required"],
    },

    // Option contract details
    contractType: {
      type: String,
      required: true,
      enum: ["CALL", "PUT"],
    },
    strike: {
      type: Number,
      required: true,
    },
    expiration: {
      type: Date,
      required: true,
    },
    daysToExpiration: {
      type: Number,
      default: function () {
        return Math.ceil(
          (this.expiration - this.entryDate) / (1000 * 60 * 60 * 24)
        );
      },
    },

    // Trade details
    type: {
      type: String,
      required: true,
      enum: ["LONG", "SHORT"],
    },
    contracts: {
      type: Number,
      required: true,
      min: 1,
    },
    entryPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    entryDate: {
      type: Date,
      required: true,
    },
    exitPrice: {
      type: Number,
      min: 0,
    },
    exitDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
    },

    // Option Greeks
    greeksAtEntry: {
      delta: Number,
      gamma: Number,
      theta: Number,
      vega: Number,
      rho: Number,
      impliedVolatility: Number,
    },
    greeksAtExit: {
      delta: Number,
      gamma: Number,
      theta: Number,
      vega: Number,
      rho: Number,
      impliedVolatility: Number,
    },

    // Market conditions
    marketConditions: {
      vix: Number,
      overallMarketTrend: {
        type: String,
        enum: ["BULLISH", "BEARISH", "NEUTRAL", "VOLATILE"],
      },
    },

    // Trade Analysis
    profitLoss: {
      realized: {
        type: Number,
        default: 0,
      },
      percentage: {
        type: Number,
        default: 0,
      },
      perContract: {
        type: Number,
        default: 0,
      },
    },
    strategy: {
      type: String,
      enum: [
        "COVERED_CALL",
        "NAKED_CALL",
        "LONG_CALL",
        "PUT_WRITE",
        "LONG_PUT",
        "IRON_CONDOR",
        "BUTTERFLY",
        "CALENDAR_SPREAD",
        "DIAGONAL_SPREAD",
        "VERTICAL_SPREAD",
        "STRADDLE",
        "STRANGLE",
        "OTHER",
      ],
      default: undefined,
    },
    setupType: {
      type: String,
      enum: [
        "MOMENTUM",
        "REVERSAL",
        "VOLATILITY_EXPANSION",
        "VOLATILITY_CONTRACTION",
        "EARNINGS_PLAY",
        "TECHNICAL_LEVEL",
        "GAMMA_SCALP",
        "THETA_DECAY",
        "OTHER",
      ],
      default: undefined,
    },
    notes: String,
    mistakes: [
      {
        type: String,
        enum: [
          "EARLY_ENTRY",
          "LATE_ENTRY",
          "EARLY_EXIT",
          "LATE_EXIT",
          "WRONG_STRIKE_SELECTION",
          "WRONG_EXPIRATION_SELECTION",
          "POSITION_SIZING",
          "IGNORED_MARKET_CONDITIONS",
          "EARNINGS_MISTAKE",
          "GAMMA_RISK",
          "THETA_DECAY_MISCALCULATION",
          "VEGA_RISK",
          "OTHER",
        ],
      },
    ],
    tags: [String],
  },
  {
    timestamps: true,
  }
);

// Calculate P/L before saving
optionTradeSchema.pre("save", function (next) {
  if (this.exitPrice && this.exitDate) {
    const contractMultiplier = 100; // Standard for options
    const entryValue = this.entryPrice * this.contracts * contractMultiplier;
    const exitValue = this.exitPrice * this.contracts * contractMultiplier;

    // Calculate P/L based on trade type
    if (this.type === "LONG") {
      this.profitLoss.realized = exitValue - entryValue;
    } else {
      this.profitLoss.realized = entryValue - exitValue;
    }

    // Calculate percentage P/L
    this.profitLoss.percentage = (this.profitLoss.realized / entryValue) * 100;

    // Calculate P/L per contract
    this.profitLoss.perContract = this.profitLoss.realized / this.contracts;

    // Update status
    this.status = "CLOSED";
  } else {
    // Reset P/L if trade is reopened
    this.profitLoss.realized = 0;
    this.profitLoss.percentage = 0;
    this.profitLoss.perContract = 0;
    this.status = "OPEN";
  }

  next();
});

const OptionTrade = mongoose.model("OptionTrade", optionTradeSchema);

module.exports = OptionTrade;
