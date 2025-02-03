// backend/routes/tradePlanRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const TradePlan = require("../models/TradePlan");

// GET all trade plans
router.get("/", protect, async (req, res) => {
  try {
    const plans = await TradePlan.find({ user: req.user._id }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// CREATE new trade plan
router.post("/", protect, async (req, res) => {
  try {
    const tradePlan = await TradePlan.create({
      ...req.body,
      user: req.user._id,
    });

    res.status(201).json({
      success: true,
      data: tradePlan,
    });
  } catch (error) {
    console.error("Error creating trade plan:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// UPDATE trade plan
router.put("/:id", protect, async (req, res) => {
  try {

    // Remove _id and other metadata fields from the update
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.__v;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.user;

    const tradePlan = await TradePlan.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!tradePlan) {
      return res.status(404).json({
        success: false,
        error: "Trade plan not found",
      });
    }

    res.json({
      success: true,
      data: tradePlan,
    });
  } catch (error) {
    console.error("Error updating trade plan:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.put("/:id/toggle-status", protect, async (req, res) => {
  try {
    const tradePlan = await TradePlan.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { status: req.body.status },
      { new: true }
    );

    if (!tradePlan) {
      return res.status(404).json({
        success: false,
        error: "Trade plan not found",
      });
    }

    res.json({
      success: true,
      data: tradePlan,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE trade plan
router.delete("/:id", protect, async (req, res) => {
  try {
    const tradePlan = await TradePlan.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!tradePlan) {
      return res.status(404).json({
        success: false,
        error: "Trade plan not found",
      });
    }

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
