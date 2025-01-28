// backend/routes/insiderTradeRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const InsiderTransaction = require("../models/InsiderTransaction");

// GET all insider trades with filtering
router.get("/", protect, async (req, res) => {
  try {
    const {
      ticker,
      dateRange,
      transactionType,
      minAmount,
      page = 1,
      limit = 50,
    } = req.query;

    let query = {};

    // Apply filters
    if (ticker) {
      query.ticker = ticker.toUpperCase();
    }

    if (dateRange) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(dateRange));
      query.filingDate = { $gte: startDate };
    }

    if (transactionType && transactionType !== "all") {
      query.transactionType = transactionType;
    }

    if (minAmount) {
      query.totalValue = { $gte: parseFloat(minAmount) };
    }

    // Execute query with pagination
    const trades = await InsiderTransaction.find(query)
      .sort({ filingDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Get total count for pagination
    const total = await InsiderTransaction.countDocuments(query);

    res.json({
      success: true,
      data: trades,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// GET summary stats for a ticker
router.get("/stats/:ticker", protect, async (req, res) => {
  try {
    const { ticker } = req.params;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get recent transactions
    const recentTrades = await InsiderTransaction.find({
      ticker: ticker.toUpperCase(),
      filingDate: { $gte: thirtyDaysAgo },
    });

    // Calculate summary statistics
    const stats = {
      totalBuyAmount: 0,
      totalSellAmount: 0,
      netAmount: 0,
      uniqueInsiders: new Set(),
      largestTransaction: null,
    };

    recentTrades.forEach((trade) => {
      if (trade.transactionType === "Purchase") {
        stats.totalBuyAmount += trade.totalValue;
      } else {
        stats.totalSellAmount += trade.totalValue;
      }
      stats.uniqueInsiders.add(trade.insiderName);

      if (
        !stats.largestTransaction ||
        trade.totalValue > stats.largestTransaction.totalValue
      ) {
        stats.largestTransaction = trade;
      }
    });

    stats.netAmount = stats.totalBuyAmount - stats.totalSellAmount;
    stats.uniqueInsiders = stats.uniqueInsiders.size;

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
