// models/InsiderTransaction.js
const mongoose = require("mongoose");

const insiderTransactionSchema = new mongoose.Schema(
  {
    filingDate: Date,
    transactionDate: Date,
    ticker: String,
    insiderName: String,
    title: String,
    transactionType: String,
    shares: Number,
    pricePerShare: Number,
    totalValue: Number,
    sharesOwned: Number,
    formType: String,
  },
  { timestamps: true }
);

const InsiderTransaction = mongoose.model(
  "InsiderTransaction",
  insiderTransactionSchema
);

// models/DarkPoolTrade.js
const darkPoolTradeSchema = new mongoose.Schema(
  {
    tradeDate: Date,
    ticker: String,
    volume: Number,
    price: Number,
    tradeValue: Number,
    venue: String,
  },
  { timestamps: true }
);

const DarkPoolTrade = mongoose.model("DarkPoolTrade", darkPoolTradeSchema);

// models/InstitutionalHolding.js
const institutionalHoldingSchema = new mongoose.Schema(
  {
    filingDate: Date,
    ticker: String,
    institutionName: String,
    sharesHeld: Number,
    valueHeld: Number,
    changeInShares: Number,
    changeInValue: Number,
  },
  { timestamps: true }
);

const InstitutionalHolding = mongoose.model(
  "InstitutionalHolding",
  institutionalHoldingSchema
);
