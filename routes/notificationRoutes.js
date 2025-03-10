const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const { protect } = require("../middleware/authMiddleware");
const mongoose = require("mongoose");

// Get all notifications for the current user
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get unread count
router.get("/unread-count", protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Mark a notification as read
router.patch("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }

    notification.read = true;
    await notification.save();

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Mark all notifications as read
router.post("/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true }
    );

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete a notification
router.delete("/:id", protect, async (req, res) => {
  try {
    const result = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }

    res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("Delete notification error:", error); // Add this for debugging
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete all notifications for a user
router.delete("/", protect, async (req, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });

    res.json({
      success: true,
      message: "All notifications deleted",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
