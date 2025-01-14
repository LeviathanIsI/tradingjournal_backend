// backend/models/Trade.js
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
      required: true,
      uppercase: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["LONG", "SHORT"],
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
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
  if (this.exitPrice && this.status === "OPEN") {
    this.status = "CLOSED";
  }

  if (this.status === "CLOSED" && this.exitPrice) {
    const entryValue = this.entryPrice * this.quantity;
    const exitValue = this.exitPrice * this.quantity;

    if (this.type === "LONG") {
      this.profitLoss.realized = exitValue - entryValue;
    } else {
      this.profitLoss.realized = entryValue - exitValue;
    }

    this.profitLoss.percentage = (this.profitLoss.realized / entryValue) * 100;
  }

  next();
});

const Trade = mongoose.model("Trade", tradeSchema);
module.exports = Trade;
