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

// GET trade plan statistics
router.get("/stats", protect, async (req, res) => {
  try {
    const stats = await TradePlan.aggregate([
      {
        $match: { user: req.user._id },
      },
      {
        $group: {
          _id: null,
          totalPlans: { $sum: 1 },
          executedPlans: {
            $sum: { $cond: [{ $eq: ["$status", "EXECUTED"] }, 1, 0] },
          },
          successfulPlans: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "EXECUTED"] },
                    { $gt: ["$actualTrade.profitLoss.realized", 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalPlans: 0,
        executedPlans: 0,
        successfulPlans: 0,
      },
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
    console.log("Received request body:", req.body);
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
    console.log("Updating trade plan:", req.params.id);
    console.log("Update data:", req.body);

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

module.exports = router;
