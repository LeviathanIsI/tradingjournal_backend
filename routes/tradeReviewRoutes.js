const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const TradeReview = require("../models/TradeReview");

router.post("/", protect, async (req, res) => {
  try {
    const review = await TradeReview.create({
      ...req.body,
      user: req.user._id,
    });
    res.status(201).json({ success: true, data: review });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/public", async (req, res) => {
  try {
    const reviews = await TradeReview.find({ isPublic: true })
      .populate("trade")
      .populate("user", "username");

    res.json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    console.error("Error fetching public reviews:", error);
    res.status(400).json({
      success: false,
      error: error.message || "Failed to fetch reviews",
    });
  }
});

module.exports = router;
