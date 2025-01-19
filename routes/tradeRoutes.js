const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const Trade = require("../models/Trade");

// Helper function to calculate P/L for a trade
const calculateProfitLoss = (trade) => {
  if (!trade.exitPrice || !trade.exitQuantity) {
    return {
      realized: 0,
      percentage: 0,
      status: "OPEN",
    };
  }

  const entryValue = trade.entryPrice * trade.entryQuantity;
  const exitValue = trade.exitPrice * trade.exitQuantity;
  let realizedPL;

  if (trade.type === "LONG") {
    realizedPL = exitValue - entryValue;
  } else {
    realizedPL = entryValue - exitValue;
  }

  return {
    realized: Number(realizedPL.toFixed(2)),
    percentage: Number(((realizedPL / entryValue) * 100).toFixed(2)),
    status: "CLOSED",
  };
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
    const trades = await Trade.find({ user: req.user._id });

    const stats = trades.reduce(
      (acc, trade) => {
        const pl = calculateProfitLoss(trade.toObject());

        if (pl.status === "CLOSED") {
          acc.totalTrades++;
          acc.totalProfit += pl.realized;

          if (pl.realized > 0) {
            acc.profitableTrades++;
            acc.totalWinAmount += pl.realized;
            acc.maxProfit = Math.max(acc.maxProfit, pl.realized);
          } else {
            acc.totalLossAmount += Math.abs(pl.realized);
            acc.maxLoss = Math.min(acc.maxLoss, pl.realized);
          }
        }

        return acc;
      },
      {
        totalTrades: 0,
        profitableTrades: 0,
        totalProfit: 0,
        totalWinAmount: 0,
        totalLossAmount: 0,
        maxProfit: 0,
        maxLoss: 0,
      }
    );

    // Calculate derived statistics
    const winRate =
      stats.totalTrades > 0
        ? Number(
            ((stats.profitableTrades / stats.totalTrades) * 100).toFixed(2)
          )
        : 0;

    const avgWinningTrade =
      stats.profitableTrades > 0
        ? Number((stats.totalWinAmount / stats.profitableTrades).toFixed(2))
        : 0;

    const avgLosingTrade =
      stats.totalTrades - stats.profitableTrades > 0
        ? Number(
            (
              stats.totalLossAmount /
              (stats.totalTrades - stats.profitableTrades)
            ).toFixed(2)
          )
        : 0;

    const profitFactor =
      stats.totalLossAmount > 0
        ? Number((stats.totalWinAmount / stats.totalLossAmount).toFixed(2))
        : 0;

    res.json({
      success: true,
      data: {
        ...stats,
        winRate,
        avgWinningTrade,
        avgLosingTrade,
        profitFactor,
      },
    });
  } catch (error) {
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

    const updatedData = {
      ...req.body,
    };

    // Calculate new P/L
    const pl = calculateProfitLoss(updatedData);
    updatedData.status = pl.status;
    updatedData.profitLoss = {
      realized: pl.realized,
      percentage: pl.percentage,
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

// In tradeRoutes.js, add a new endpoint for pattern analysis
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

module.exports = router;
