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
        "Other",
      ],
      required: false,
    },
    mentalState: {
      focus: {
        type: Number,
        min: 1,
        max: 10,
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
        ],
      },
      notes: String,
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
      required: true,
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
    const entryDay = new Date(this.entryDate).toDateString();
    const exitDay = new Date(this.exitDate).toDateString();

    if (entryDay !== exitDay) {
      next(new Error("Day trades must have entry and exit on the same day"));
      return;
    }
  }
  next();
});

const Trade = mongoose.model("Trade", tradeSchema);

module.exports = Trade;
