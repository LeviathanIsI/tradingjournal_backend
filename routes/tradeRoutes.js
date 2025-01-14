// backend/routes/tradeRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const Trade = require("../models/Trade");

// GET all trades for a user
router.get("/", protect, async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({
      createdAt: -1,
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

// GET trade statistics
router.get("/stats", protect, async (req, res) => {
  try {
    const stats = await Trade.aggregate([
      {
        $match: { user: req.user._id },
      },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          profitableTrades: {
            $sum: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          totalProfit: {
            $sum: "$profitLoss.realized",
          },
          avgProfitPerTrade: {
            $avg: "$profitLoss.realized",
          },
          winRate: {
            $avg: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          maxProfit: { $max: "$profitLoss.realized" },
          maxLoss: { $min: "$profitLoss.realized" },
          avgWinningTrade: {
            $avg: {
              $cond: [
                { $gt: ["$profitLoss.realized", 0] },
                "$profitLoss.realized",
                null,
              ],
            },
          },
          avgLosingTrade: {
            $avg: {
              $cond: [
                { $lt: ["$profitLoss.realized", 0] },
                "$profitLoss.realized",
                null,
              ],
            },
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
        avgProfitPerTrade: 0,
        winRate: 0,
        maxProfit: 0,
        maxLoss: 0,
        avgWinningTrade: 0,
        avgLosingTrade: 0,
        profitFactor: 0,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// GET single trade
router.get("/:id", protect, async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: "Trade not found",
      });
    }

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

// CREATE new trade
router.post("/", protect, async (req, res) => {
  try {
    req.body.user = req.user._id;
    const trade = await Trade.create(req.body);

    res.status(201).json({
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

// UPDATE trade
router.put("/:id", protect, async (req, res) => {
  try {
    let trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: "Trade not found",
      });
    }

    // Set status based on exit fields
    if (req.body.exitPrice && req.body.exitDate) {
      req.body.status = "CLOSED";
    } else {
      req.body.status = "OPEN";
    }

    // Calculate P/L if trade is closed
    if (req.body.status === "CLOSED") {
      const entryValue = req.body.entryPrice * req.body.quantity;
      const exitValue = req.body.exitPrice * req.body.quantity;

      if (req.body.type === "LONG") {
        req.body.profitLoss = {
          realized: exitValue - entryValue,
          percentage: ((exitValue - entryValue) / entryValue) * 100,
        };
      } else {
        req.body.profitLoss = {
          realized: entryValue - exitValue,
          percentage: ((entryValue - exitValue) / entryValue) * 100,
        };
      }
    } else {
      req.body.profitLoss = {
        realized: 0,
        percentage: 0,
      };
    }

    trade = await Trade.findByIdAndUpdate(req.params.id, req.body, {
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

// DELETE trade
router.delete("/:id", protect, async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: "Trade not found",
      });
    }

    await Trade.findByIdAndDelete(req.params.id); // Changed from trade.remove()

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

module.exports = router;
