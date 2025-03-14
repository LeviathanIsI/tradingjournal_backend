const axios = require("axios");
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const Trade = require("../models/Trade");
const OptionTrade = require("../models/OptionTrade");

// Helper function to calculate P/L for a trade
const calculateProfitLoss = (trade) => {
  if (!trade.exitPrice || !trade.exitQuantity) {
    return {
      realized: 0,
      percentage: 0,
      status: "OPEN",
    };
  }

  const entryValue = Number(trade.entryPrice) * Number(trade.entryQuantity);
  const exitValue = Number(trade.exitPrice) * Number(trade.exitQuantity);

  let realizedPL;

  if (trade.type === "LONG") {
    realizedPL = exitValue - entryValue;
  } else {
    realizedPL = entryValue - exitValue;
  }

  // Ensure we're not dividing by zero
  if (entryValue === 0) {
    throw new Error("Entry value cannot be zero");
  }

  const result = {
    realized: Number(realizedPL.toFixed(2)),
    percentage: Number(((realizedPL / entryValue) * 100).toFixed(2)),
    status: "CLOSED",
  };
  return result;
};

// GET all trades
router.get("/", protect, async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({
      entryDate: -1,
    });

    const processedTrades = trades.map((trade) => {
      const pl = calculateProfitLoss(trade.toObject());
      return {
        ...trade.toObject(),
        profitLoss: pl,
      };
    });

    res.json({
      success: true,
      count: trades.length,
      data: processedTrades,
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
    // Get all trades (both stock and options)
    const stockTrades = await Trade.find({
      user: req.user._id,
      status: "CLOSED",
    });

    const optionTrades = await OptionTrade.find({
      user: req.user._id,
      status: "CLOSED",
    });

    // Count and sum up all trades
    let totalTrades = stockTrades.length + optionTrades.length;
    let profitableTrades = 0;
    let totalProfit = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;

    // Process stock trades
    stockTrades.forEach((trade) => {
      const pl = trade.profitLoss.realized;
      totalProfit += pl;

      if (pl > 0) {
        profitableTrades++;
        totalWinAmount += pl;
      } else if (pl < 0) {
        totalLossAmount += Math.abs(pl);
      }
    });

    // Process option trades
    optionTrades.forEach((trade) => {
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
    console.error("Stats error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// POST new trade
router.post("/", protect, async (req, res) => {
  try {
    // Validate required fields
    const requiredFields = [
      "symbol",
      "type",
      "tradeType",
      "entryPrice",
      "entryQuantity",
      "entryDate",
    ];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const tradeData = {
      ...req.body,
      user: req.user._id,
    };

    // Calculate initial P/L
    const pl = calculateProfitLoss(tradeData);
    tradeData.status = pl.status;
    tradeData.profitLoss = {
      realized: pl.realized,
      percentage: pl.percentage,
    };

    const trade = await Trade.create(tradeData);

    res.status(201).json({
      success: true,
      data: {
        ...trade.toObject(),
        profitLoss: pl,
      },
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

    // Convert numeric fields
    const tradeForPL = {
      type: req.body.type,
      entryPrice: Number(req.body.entryPrice) || 0,
      entryQuantity: Number(req.body.entryQuantity) || 0,
      exitPrice: req.body.exitPrice ? Number(req.body.exitPrice) : null,
      exitQuantity: req.body.exitQuantity
        ? Number(req.body.exitQuantity)
        : null,
    };

    // Calculate new P/L
    const pl = calculateProfitLoss(tradeForPL);

    const updatedData = {
      ...req.body,
      entryPrice: Number(req.body.entryPrice),
      entryQuantity: Number(req.body.entryQuantity),
      exitPrice: req.body.exitPrice ? Number(req.body.exitPrice) : undefined,
      exitQuantity: req.body.exitQuantity
        ? Number(req.body.exitQuantity)
        : undefined,
      postExitHigh: req.body.postExitHigh
        ? Number(req.body.postExitHigh)
        : null,
      postExitLow: req.body.postExitLow ? Number(req.body.postExitLow) : null,
      postExitAnalysis: {
        lowBeforeHigh:
          req.body.postExitAnalysis?.lowBeforeHigh ??
          trade.postExitAnalysis?.lowBeforeHigh,
        timeOfLow:
          req.body.postExitAnalysis?.timeOfLow ??
          trade.postExitAnalysis?.timeOfLow,
        timeOfHigh:
          req.body.postExitAnalysis?.timeOfHigh ??
          trade.postExitAnalysis?.timeOfHigh,
      },
      profitLoss: {
        realized: pl.realized,
        percentage: pl.percentage,
      },
      status: pl.status,
    };

    trade = await Trade.findByIdAndUpdate(req.params.id, updatedData, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      data: {
        ...trade.toObject(),
        profitLoss: pl,
      },
    });
  } catch (error) {
    console.error("Update error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update POST route
router.post("/", protect, async (req, res) => {
  try {
    const requiredFields = [
      "symbol",
      "type",
      "tradeType",
      "entryPrice",
      "entryQuantity",
      "entryDate",
    ];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const tradeData = {
      ...req.body,
      user: req.user._id,
      postExitAnalysis: {
        lowBeforeHigh: req.body.postExitAnalysis?.lowBeforeHigh || null,
        timeOfLow: req.body.postExitAnalysis?.timeOfLow || null,
        timeOfHigh: req.body.postExitAnalysis?.timeOfHigh || null,
      },
    };

    // Ensure numeric fields for P/L calculation
    const tradeForPL = {
      type: tradeData.type,
      entryPrice: Number(tradeData.entryPrice),
      entryQuantity: Number(tradeData.entryQuantity),
      exitPrice: tradeData.exitPrice ? Number(tradeData.exitPrice) : null,
      exitQuantity: tradeData.exitQuantity
        ? Number(tradeData.exitQuantity)
        : null,
    };

    // Calculate initial P/L
    const pl = calculateProfitLoss(tradeForPL);
    tradeData.status = pl.status;
    tradeData.profitLoss = {
      realized: pl.realized,
      percentage: pl.percentage,
    };

    const trade = await Trade.create(tradeData);

    res.status(201).json({
      success: true,
      data: {
        ...trade.toObject(),
        profitLoss: pl,
      },
    });
  } catch (error) {
    console.error("Create error:", error);
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

    await Trade.findByIdAndDelete(req.params.id);

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
    const trades = await Trade.find({
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
    await Trade.deleteMany({
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

router.get("/analysis/patterns", protect, async (req, res) => {
  try {
    const patterns = await Trade.aggregate([
      { $match: { user: req.user._id, status: "CLOSED" } },
      {
        $group: {
          _id: "$pattern",
          totalTrades: { $sum: 1 },
          winningTrades: {
            $sum: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
      {
        $project: {
          pattern: "$_id",
          totalTrades: 1,
          winningTrades: 1,
          totalProfit: 1,
          winRate: {
            $multiply: [{ $divide: ["$winningTrades", "$totalTrades"] }, 100],
          },
          averageProfit: {
            $divide: ["$totalProfit", "$totalTrades"],
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: patterns,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Add time analysis endpoint
router.get("/analysis/time", protect, async (req, res) => {
  try {
    const timeAnalysis = await Trade.aggregate([
      { $match: { user: req.user._id, status: "CLOSED" } },
      {
        $group: {
          _id: {
            hour: { $hour: "$entryDate" },
            session: "$session",
          },
          totalTrades: { $sum: 1 },
          winningTrades: {
            $sum: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
      { $sort: { "_id.hour": 1 } },
    ]);

    res.json({
      success: true,
      data: timeAnalysis,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Add trading streak endpoint
router.get("/analysis/streak", protect, async (req, res) => {
  try {
    const trades = await Trade.find({
      user: req.user._id,
      status: "CLOSED",
    }).sort({ exitDate: 1 });

    let currentStreak = 0;
    let maxStreak = 0;
    let previousDate = null;
    let dailyPL = 0;

    trades.forEach((trade) => {
      const tradeDate = new Date(trade.exitDate).toDateString();

      if (tradeDate !== previousDate) {
        if (dailyPL > 0) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
        dailyPL = trade.profitLoss.realized;
        previousDate = tradeDate;
      } else {
        dailyPL += trade.profitLoss.realized;
      }
    });

    res.json({
      success: true,
      data: {
        currentStreak,
        maxStreak,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// GET time-based analysis
router.get("/analysis/time", protect, async (req, res) => {
  try {
    const timeAnalysis = await Trade.aggregate([
      {
        $match: {
          user: req.user._id,
          status: "CLOSED",
        },
      },
      {
        $group: {
          _id: {
            hour: { $hour: "$entryDate" },
            session: "$session",
          },
          totalTrades: { $sum: 1 },
          winningTrades: {
            $sum: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
      {
        $project: {
          hour: "$_id.hour",
          session: "$_id.session",
          totalTrades: 1,
          winningTrades: 1,
          totalProfit: 1,
          winRate: {
            $multiply: [{ $divide: ["$winningTrades", "$totalTrades"] }, 100],
          },
          avgProfit: {
            $divide: ["$totalProfit", "$totalTrades"],
          },
        },
      },
      { $sort: { hour: 1 } },
    ]);

    res.json({
      success: true,
      data: timeAnalysis,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// GET session statistics
router.get("/analysis/sessions", protect, async (req, res) => {
  try {
    const sessionStats = await Trade.aggregate([
      {
        $match: {
          user: req.user._id,
          status: "CLOSED",
        },
      },
      {
        $group: {
          _id: "$session",
          totalTrades: { $sum: 1 },
          winningTrades: {
            $sum: {
              $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0],
            },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
      {
        $project: {
          session: "$_id",
          totalTrades: 1,
          winningTrades: 1,
          totalProfit: 1,
          winRate: {
            $multiply: [{ $divide: ["$winningTrades", "$totalTrades"] }, 100],
          },
          avgProfit: {
            $divide: ["$totalProfit", "$totalTrades"],
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: sessionStats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/analysis/drawdown", protect, async (req, res) => {
  try {
    const trades = await Trade.find({
      user: req.user._id,
      status: "CLOSED",
    }).sort({ exitDate: 1 });

    // Calculate drawdown metrics
    let maxDrawdown = 0;
    let currentDrawdown = 0;
    let maxConsecutiveLosses = 0;
    let currentLossStreak = 0;
    let biggestLoss = 0;
    let equity = 0;
    let peakEquity = 0;

    trades.forEach((trade) => {
      const pl = trade.profitLoss.realized;
      equity += pl;

      // Update peak equity
      if (equity > peakEquity) {
        peakEquity = equity;
      }

      // Calculate drawdown
      currentDrawdown = peakEquity - equity;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Track consecutive losses
      if (pl < 0) {
        currentLossStreak++;
        if (currentLossStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentLossStreak;
        }
        if (pl < biggestLoss) {
          biggestLoss = pl;
        }
      } else {
        currentLossStreak = 0;
      }
    });

    res.json({
      success: true,
      data: {
        maxDrawdown,
        maxConsecutiveLosses,
        biggestLoss,
        currentDrawdown: equity < peakEquity ? peakEquity - equity : 0,
        peakEquity,
        currentEquity: equity,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// In tradeRoutes.js
router.get("/analysis/streaks", protect, async (req, res) => {
  try {
    const trades = await Trade.find({
      user: req.user._id,
      status: "CLOSED",
    }).sort({ exitDate: 1 });

    let currentStreak = 0;
    let longestStreak = 0;
    let totalStreaks = 0;
    let streakCount = 0;
    let previousDate = null;
    let dailyPL = 0;

    const streakData = trades.reduce((acc, trade) => {
      const tradeDate = new Date(trade.exitDate).toDateString();

      if (tradeDate !== previousDate) {
        if (dailyPL > 0) {
          currentStreak++;
          longestStreak = Math.max(longestStreak, currentStreak);
          streakCount++;
        } else if (dailyPL < 0) {
          currentStreak = 0;
        }
        dailyPL = trade.profitLoss.realized;
        previousDate = tradeDate;
        totalStreaks += currentStreak > 0 ? 1 : 0;
      } else {
        dailyPL += trade.profitLoss.realized;
      }

      return {
        currentStreak,
        longestStreak,
        averageStreak: totalStreaks
          ? (totalStreaks / streakCount).toFixed(1)
          : 0,
      };
    }, {});

    res.json({
      success: true,
      data: streakData,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// backend/routes/tradeRoutes.js
router.post("/import", protect, async (req, res) => {
  try {
    const { trades } = req.body;

    // Add user ID to each trade
    const tradesWithUser = trades.map((trade) => ({
      ...trade,
      user: req.user._id,
    }));

    // Insert all trades
    const result = await Trade.insertMany(tradesWithUser);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// In your trade routes
router.post("/update-post-exit-data", protect, async (req, res) => {
  try {
    const { tradeId, postExitHigh, postExitLow } = req.body;

    const trade = await Trade.findByIdAndUpdate(
      tradeId,
      {
        postExitHigh,
        postExitLow,
        optimalExitPrice: Math.max(postExitHigh, trade.exitPrice),
      },
      { new: true }
    );

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

module.exports = router;
