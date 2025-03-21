const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    symbol: {
      type: String,
      required: [true, "Symbol is required"],
      uppercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: "Symbol cannot be empty",
      },
    },
    type: {
      type: String,
      required: true,
      enum: ["LONG", "SHORT"],
    },
    tradeType: {
      type: String,
      required: true,
      enum: ["DAY", "SWING"],
    },
    // Entry details
    entryPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    entryQuantity: {
      type: Number,
      required: true,
      min: 1,
    },
    entryDate: {
      type: Date,
      required: true,
    },
    // Exit details (optional for open trades)
    exitPrice: {
      type: Number,
      min: 0,
    },
    exitQuantity: {
      type: Number,
      min: 0,
    },
    exitDate: {
      type: Date,
    },
    postExitAnalysis: {
      lowBeforeHigh: {
        type: Boolean,
        default: null,
        description:
          "Indicates if the lowest price came before the highest price after exit",
      },
      timeOfLow: {
        type: Date,
        default: null,
        description: "Time when the lowest price was reached",
      },
      timeOfHigh: {
        type: Date,
        default: null,
        description: "Time when the highest price was reached",
      },
    },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
    },
    profitLoss: {
      realized: {
        type: Number,
        default: 0,
      },
      percentage: {
        type: Number,
        default: 0,
      },
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    pattern: {
      type: String,
      enum: [
        "Gap Up",
        "Gap Down",
        "Breakout",
        "Breakdown",
        "Reversal",
        "Trend Following",
        "Range Play",
        "VWAP Play",
        "Opening Range",
        "First Pullback",
        "RCT",
        "ABCD Pattern",
        "1st Green Day",
        "1st Red Day",
        "Other",
      ],
      required: false,
    },
    mentalState: {
      focus: {
        type: Number,
        min: 1,
        max: 10,
        required: false,
        default: null,
      },
      emotion: {
        type: String,
        enum: [
          "Calm",
          "Excited",
          "Fearful",
          "Confident",
          "Frustrated",
          "Neutral",
          null,
          "",
        ],
        required: false,
        default: null,
      },
      notes: String,
    },
    riskManagement: {
      accountSize: {
        type: Number,
        default: null,
      },
      riskPercentage: {
        type: Number,
        default: null,
      },
      riskAmount: {
        type: Number,
        default: null,
      },
      maxLoss: {
        type: Number,
        default: null,
      },
      plannedRR: {
        type: Number,
        default: null,
      },
      suggestedShares: {
        type: Number,
        default: null,
      },
    },
    mistakes: [
      {
        type: String,
        enum: [
          "FOMO",
          "Sized Too Big",
          "Poor Entry",
          "Poor Exit",
          "No Stop Loss",
          "Moved Stop Loss",
          "Break Trading Rules",
          "Chasing",
          "Revenge Trading",
          "Other",
        ],
      },
    ],
    session: {
      type: String,
      enum: ["Pre-Market", "Regular", "After-Hours"],
      default: "Regular",
    },
    postExitHigh: {
      type: Number,
      default: null, // Highest price after exit
    },
    postExitLow: {
      type: Number,
      default: null, // Lowest price after exit
    },
    violatedRules: [
      {
        rule: String,
        description: String,
      },
    ],
    strategy: String,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Calculate P/L before saving
tradeSchema.pre("save", function (next) {
  // Only calculate if we have exit details
  if (this.exitPrice && this.exitQuantity && this.exitDate) {
    const entryValue = this.entryPrice * this.entryQuantity;
    const exitValue = this.exitPrice * this.exitQuantity;

    // Calculate P/L based on trade type
    if (this.type === "LONG") {
      this.profitLoss.realized = exitValue - entryValue;
    } else {
      this.profitLoss.realized = entryValue - exitValue;
    }

    // Calculate percentage P/L
    this.profitLoss.percentage = (this.profitLoss.realized / entryValue) * 100;

    // Update status
    this.status = "CLOSED";
  } else {
    // Reset P/L and status if exit details are removed
    this.profitLoss.realized = 0;
    this.profitLoss.percentage = 0;
    this.status = "OPEN";
  }

  next();
});

// Validate day trade dates
tradeSchema.pre("save", function (next) {
  if (this.tradeType === "DAY" && this.exitDate) {
    // If a validation field exists, use it for validation
    if (this._validationSameDayAs) {
      // We're allowing this special case
      this._validationSameDayAs = undefined; // Remove before saving
    } else {
      // Original 24-hour validation for all other cases
      const entryDate = new Date(this.entryDate);
      const exitDate = new Date(this.exitDate);
      const hoursDifference = Math.abs(exitDate - entryDate) / (1000 * 60 * 60);

      if (hoursDifference > 24) {
        next(new Error("Day trades must have entry and exit within 24 hours"));
        return;
      }
    }
  }
  next();
});

const Trade = mongoose.model("Trade", tradeSchema);

module.exports = Trade;
