// backend/models/Trade.js
const mongoose = require("mongoose");

const legSchema = new mongoose.Schema({
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  date: {
    type: Date,
    required: true,
  },
  type: {
    type: String,
    enum: ["ENTRY", "EXIT"],
    required: true,
  },
});

const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    symbol: {
      type: String,
      required: true,
      uppercase: true,
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
    legs: [legSchema],
    status: {
      type: String,
      enum: ["OPEN", "CLOSED", "PARTIALLY_CLOSED"],
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
    strategy: {
      type: String,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Calculate P/L before saving
tradeSchema.pre("save", function (next) {
  // Only calculate if there are exit legs
  const exitLegs = this.legs.filter((leg) => leg.type === "EXIT");
  const entryLegs = this.legs.filter((leg) => leg.type === "ENTRY");

  if (exitLegs.length > 0) {
    let totalEntryValue = 0;
    let totalExitValue = 0;
    let totalEntryQuantity = 0;
    let totalExitQuantity = 0;

    // Calculate entry totals
    entryLegs.forEach((leg) => {
      totalEntryValue += leg.price * leg.quantity;
      totalEntryQuantity += leg.quantity;
    });

    // Calculate exit totals
    exitLegs.forEach((leg) => {
      totalExitValue += leg.price * leg.quantity;
      totalExitQuantity += leg.quantity;
    });

    // Update status based on quantities
    if (totalExitQuantity === totalEntryQuantity) {
      this.status = "CLOSED";
    } else if (totalExitQuantity > 0) {
      this.status = "PARTIALLY_CLOSED";
    }

    // Calculate P/L if trade is fully or partially closed
    if (totalExitQuantity > 0) {
      if (this.type === "LONG") {
        this.profitLoss.realized =
          totalExitValue -
          (totalExitQuantity / totalEntryQuantity) * totalEntryValue;
      } else {
        this.profitLoss.realized =
          (totalExitQuantity / totalEntryQuantity) * totalEntryValue -
          totalExitValue;
      }

      this.profitLoss.percentage =
        (this.profitLoss.realized /
          ((totalExitQuantity / totalEntryQuantity) * totalEntryValue)) *
        100;
    }
  }

  next();
});

const Trade = mongoose.model("Trade", tradeSchema);
module.exports = Trade;
