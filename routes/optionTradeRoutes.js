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
    const stats = await OptionTrade.aggregate([
      { $match: { user: req.user._id } },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          profitableTrades: {
            $sum: { $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0] },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
      {
        $project: {
          _id: 0,
          totalTrades: 1,
          profitableTrades: 1,
          totalProfit: 1,
          winRate: {
            $multiply: [
              { $divide: ["$profitableTrades", "$totalTrades"] },
              100,
            ],
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalTrades: 0,
        profitableTrades: 0,
        totalProfit: 0,
        winRate: 0,
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
