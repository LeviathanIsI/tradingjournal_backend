const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { adminProtect } = require("../middleware/adminMiddleware");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const Settings = require("../models/Settings");

// Get admin dashboard stats
router.get("/stats", adminProtect, async (req, res) => {
  try {
    // Count total users
    const totalUsers = await User.countDocuments();

    // Count active subscriptions
    const paidSubscriptions = await User.countDocuments({
      "subscription.active": true,
    });

    // Count active users (logged in within the last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsers = await User.countDocuments({
      lastLoginDate: { $gte: thirtyDaysAgo },
    });

    // Count total messages sent through the notification system
    const messagesSent = await Notification.countDocuments({
      type: { $in: ["announcement", "alert"] },
    });

    // For average session time, this would typically come from an analytics service
    // This is a placeholder value
    const averageSessionTime = 24; // minutes

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        paidSubscriptions,
        messagesSent,
        averageSessionTime,
      },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch admin statistics",
    });
  }
});

// Get all users
router.get("/users", adminProtect, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

// Get user by ID
router.get("/users/:userId", adminProtect, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user details",
    });
  }
});

// Update user
router.put("/users/:userId", adminProtect, async (req, res) => {
  try {
    const { username, email, subscription, specialAccess } = req.body;

    // Find user
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Update user fields
    if (username) user.username = username;
    if (email) user.email = email;

    // Update subscription if provided
    if (subscription) {
      user.subscription = {
        ...user.subscription,
        ...subscription,
      };
    }

    // Update special access if provided
    if (specialAccess) {
      user.specialAccess = {
        ...user.specialAccess,
        ...specialAccess,
      };
    }

    await user.save();

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update user",
    });
  }
});

// Send message to users
router.post("/messages/send", adminProtect, async (req, res) => {
  try {
    const { subject, message, recipients, messageType, priority } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Subject and message are required",
      });
    }

    let targetUsers;

    // Determine target users
    if (recipients === "all") {
      targetUsers = await User.find().select("_id");
    } else if (Array.isArray(recipients)) {
      // If recipients is an array of emails
      targetUsers = await User.find({ email: { $in: recipients } }).select(
        "_id"
      );
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid recipients format",
      });
    }

    if (targetUsers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid recipients found",
      });
    }

    // Create notifications for each user
    await User.updateMany(
      { _id: { $in: targetUsers.map((u) => u._id) } },
      { $push: { notifications: { title: subject, content: message } } }
    );
  } catch (error) {
    console.error("Error sending messages:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send messages",
    });
  }
});

// Get previous messages sent by admins
router.get("/messages", adminProtect, async (req, res) => {
  try {
    const messages = await Notification.aggregate([
      {
        $match: {
          adminMessage: true,
          sender: req.user._id,
        },
      },
      {
        $group: {
          _id: "$title",
          message: { $first: "$content" },
          messageType: { $first: "$type" },
          priority: { $first: "$priority" },
          sentAt: { $first: "$createdAt" },
          totalCount: { $sum: 1 },
          readCount: {
            $sum: {
              $cond: [{ $eq: ["$read", true] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          subject: "$_id",
          message: 1,
          messageType: 1,
          priority: 1,
          sentAt: 1,
          totalCount: 1,
          readCount: 1,
          sentTo: "all", // Simplification - would need more logic to determine "specific"
        },
      },
      {
        $sort: { sentAt: -1 },
      },
    ]);

    res.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages",
    });
  }
});

// Get admin settings
router.get("/settings", adminProtect, async (req, res) => {
  try {
    // Get settings from database
    const settings = await Settings.getSettings();

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch settings",
    });
  }
});

// Update admin settings
router.put("/settings", adminProtect, async (req, res) => {
  try {
    const {
      maintenanceMode,
      allowNewRegistrations,
      defaultUserSubscriptionDays,
      enabledFeatures,
    } = req.body;

    // Get current settings
    const settings = await Settings.getSettings();

    // Handle maintenanceMode carefully - ensure complete object structure
    if (maintenanceMode !== undefined) {
      // Make sure we have all required fields
      settings.maintenanceMode = {
        enabled:
          maintenanceMode.enabled !== undefined
            ? maintenanceMode.enabled
            : settings.maintenanceMode?.enabled || false,
        message:
          maintenanceMode.message !== undefined
            ? maintenanceMode.message
            : settings.maintenanceMode?.message ||
              "The site is currently undergoing scheduled maintenance. Please check back shortly.",
      };
    }

    // Update other fields normally
    if (allowNewRegistrations !== undefined) {
      settings.allowNewRegistrations = allowNewRegistrations;
    }

    if (defaultUserSubscriptionDays !== undefined) {
      settings.defaultUserSubscriptionDays = defaultUserSubscriptionDays;
    }

    if (enabledFeatures !== undefined) {
      settings.enabledFeatures = {
        ...settings.enabledFeatures,
        ...enabledFeatures,
      };
    }

    // Update metadata
    settings.lastUpdated = Date.now();
    settings.updatedBy = req.user._id;

    // Save changes - handle both mongoose and non-mongoose objects
    if (settings.save && typeof settings.save === "function") {
      await settings.save();
    } else {
      const settingsModel = mongoose.model("Settings");
      await settingsModel.findOneAndUpdate({}, settings, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
    }

    // Invalidate any cached settings immediately
    if (global.cachedSettings) {
      global.cachedSettings = null;
      global.lastFetched = 0;
    }

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update settings",
      details: error.message,
      stack: error.stack,
    });
  }
});

// Add a test route for settings
router.get("/test-settings", adminProtect, async (req, res) => {
  try {

    // Check if Settings model is available
    if (!Settings) {
      return res.status(500).json({
        success: false,
        error: "Settings model not available",
      });
    }

    const settings = await Settings.getSettings();

    res.json({
      success: true,
      message: "Settings retrieved successfully",
      settings: settings,
      isMongooseDocument: !!(settings && settings.toObject),
      settingsId: settings._id
        ? settings._id.toString()
        : "No ID (likely not a mongoose document)",
    });
  } catch (error) {
    console.error("Error in test-settings:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

// Add admin verification route
router.get("/verify-admin", adminProtect, (req, res) => {
  res.json({
    success: true,
    message: "Admin access confirmed",
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      specialAccess: req.user.specialAccess,
    },
  });
});

module.exports = router;
