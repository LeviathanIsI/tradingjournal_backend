const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const OptionTrade = require("../models/OptionTrade");

// GET all option trades
router.get("/", protect, async (req, res) => {
  try {
    const trades = await OptionTrade.find({ user: req.user._id }).sort({
      entryDate: -1,
    });
    res.json({
      success: true,
      count: trades.length,
      data: trades,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// POST new option trade
router.post("/", protect, async (req, res) => {
  try {
    const tradeData = {
      ...req.body,
      user: req.user._id,
    };

    const trade = await OptionTrade.create(tradeData);

    res.status(201).json({
      success: true,
      data: trade,
    });
  } catch (error) {
    console.error("Error creating option trade:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// UPDATE option trade
router.put("/:id", protect, async (req, res) => {
  try {
    let trade = await OptionTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: "Trade not found",
      });
    }

    trade = await OptionTrade.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      data: trade,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE option trade
router.delete("/:id", protect, async (req, res) => {
  try {
    const trade = await OptionTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: "Trade not found",
      });
    }

    await OptionTrade.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      data: {},
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// GET option trade statistics
router.get("/stats", protect, async (req, res) => {
  try {
    const trades = await OptionTrade.find({
      user: req.user._id,
      status: "CLOSED",
    });

    let totalTrades = trades.length;
    let profitableTrades = 0;
    let totalProfit = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;

    // Process trades
    trades.forEach((trade) => {
      const pl = trade.profitLoss.realized;
      totalProfit += pl;

      if (pl > 0) {
        profitableTrades++;
        totalWinAmount += pl;
      } else if (pl < 0) {
        totalLossAmount += Math.abs(pl);
      }
    });

    // Calculate losing trades
    const losingTrades = totalTrades - profitableTrades;

    // Calculate win rate
    const winRate =
      totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;

    // Calculate win/loss ratio
    const winLossRatio =
      losingTrades > 0 ? profitableTrades / losingTrades : profitableTrades;

    res.json({
      success: true,
      data: {
        totalTrades,
        profitableTrades,
        losingTrades,
        totalProfit,
        totalWinAmount,
        totalLossAmount,
        winRate,
        winLossRatio,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Bulk delete option trades
router.post("/bulk-delete", protect, async (req, res) => {
  try {
    const { tradeIds } = req.body;

    if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No trade IDs provided for deletion",
      });
    }

    // Verify all trades belong to the user before deletion
    const trades = await OptionTrade.find({
      _id: { $in: tradeIds },
      user: req.user._id,
    });

    if (trades.length !== tradeIds.length) {
      return res.status(403).json({
        success: false,
        error: "Some trades not found or unauthorized",
      });
    }

    // Perform bulk deletion
    await OptionTrade.deleteMany({
      _id: { $in: tradeIds },
      user: req.user._id,
    });

    res.json({
      success: true,
      message: `Successfully deleted ${trades.length} trades`,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
