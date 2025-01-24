const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Trade = require("../models/Trade");
const { protect } = require("../middleware/authMiddleware");
const TradeReview = require("../models/TradeReview");

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        error: "User already exists",
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password,
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          username: user.username,
          email: user.email,
          token: generateToken(user._id),
        },
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user email
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        preferences: user.preferences,
        token: generateToken(user._id),
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Get user settings
// @route   GET /api/auth/settings
// @access  Private
router.get("/settings", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      success: true,
      data: user.preferences,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Update user settings
// @route   PUT /api/auth/settings
// @access  Private
router.put("/settings", protect, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { preferences: { ...req.body } },
      { new: true }
    );

    res.json({
      success: true,
      data: user.preferences,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get user profile
router.get("/profile/:username", protect, async (req, res) => {
  try {
    // Get the requesting user's ID from the token if it exists
    const requestingUserId = req.headers.authorization ? req.user?._id : null;

    // Find the requested profile
    const user = await User.findOne({ username: req.params.username });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // If viewing own profile, include email but exclude password
    // If viewing other profile, exclude both password and email
    const userProfile = await User.findById(user._id).select(
      requestingUserId && requestingUserId.equals(user._id)
        ? "-password"
        : "-password -email"
    );

    // Get user's reviews and stats
    const reviews = await TradeReview.find({
      user: user._id,
      isPublic: true,
    })
      .populate("trade")
      .sort({ createdAt: -1 });

    // Calculate user stats
    const stats = await Trade.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          winningTrades: {
            $sum: { $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0] },
          },
          totalProfit: { $sum: "$profitLoss.realized" },
        },
      },
    ]);

    const trades = await Trade.find({ user: user._id }).sort({ entryDate: -1 });

    res.json({
      success: true,
      data: {
        user: userProfile,
        reviews,
        trades,
        stats: stats[0] || {
          totalTrades: 0,
          winningTrades: 0,
          totalProfit: 0,
        },
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Follow/Unfollow user
router.post("/follow/:userId", protect, async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "You cannot follow yourself",
      });
    }

    const userToFollow = await User.findById(req.params.userId);
    const currentUser = await User.findById(req.user._id);

    if (!userToFollow || !currentUser) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const isFollowing = currentUser.following.includes(userToFollow._id);

    if (isFollowing) {
      // Unfollow
      currentUser.following = currentUser.following.filter(
        (id) => !id.equals(userToFollow._id)
      );
      userToFollow.followers = userToFollow.followers.filter(
        (id) => !id.equals(currentUser._id)
      );
    } else {
      // Follow
      currentUser.following.push(userToFollow._id);
      userToFollow.followers.push(currentUser._id);
    }

    await Promise.all([currentUser.save(), userToFollow.save()]);

    res.json({
      success: true,
      data: {
        isFollowing: !isFollowing,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update profile
router.put("/profile", protect, async (req, res) => {
  try {
    const { bio, tradingStyle } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { bio, tradingStyle },
      { new: true }
    ).select("-password");

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get all traders with stats
router.get("/traders", protect, async (req, res) => {
  try {
    const traders = await User.find().select("-password -email").lean();

    // Get stats for each trader
    const tradersWithStats = await Promise.all(
      traders.map(async (trader) => {
        const stats = await Trade.aggregate([
          { $match: { user: trader._id } },
          {
            $group: {
              _id: null,
              totalTrades: { $sum: 1 },
              winningTrades: {
                $sum: { $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0] },
              },
              totalProfit: { $sum: "$profitLoss.realized" },
            },
          },
        ]);

        const traderStats = stats[0] || {
          totalTrades: 0,
          winningTrades: 0,
          totalProfit: 0,
        };

        return {
          ...trader,
          stats: {
            ...traderStats,
            winRate: traderStats.totalTrades
              ? (
                  (traderStats.winningTrades / traderStats.totalTrades) *
                  100
                ).toFixed(1)
              : 0,
          },
        };
      })
    );

    res.json({
      success: true,
      data: tradersWithStats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get leaderboard data
router.get("/leaderboard", protect, async (req, res) => {
  try {
    const { timeFrame } = req.query;
    let dateFilter = {};

    // Apply time frame filter
    if (timeFrame !== "all") {
      const now = new Date();
      let startDate;

      switch (timeFrame) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case "year":
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = null;
      }

      if (startDate) {
        dateFilter = { createdAt: { $gte: startDate } };
      }
    }

    const traders = await User.find().select("-password -email").lean();

    // Get stats for each trader with time frame filter
    const tradersWithStats = await Promise.all(
      traders.map(async (trader) => {
        const stats = await Trade.aggregate([
          {
            $match: {
              user: trader._id,
              ...dateFilter,
            },
          },
          {
            $group: {
              _id: null,
              totalTrades: { $sum: 1 },
              winningTrades: {
                $sum: { $cond: [{ $gt: ["$profitLoss.realized", 0] }, 1, 0] },
              },
              totalProfit: { $sum: "$profitLoss.realized" },
            },
          },
        ]);

        const traderStats = stats[0] || {
          totalTrades: 0,
          winningTrades: 0,
          totalProfit: 0,
        };

        return {
          ...trader,
          stats: {
            ...traderStats,
            winRate: traderStats.totalTrades
              ? (
                  (traderStats.winningTrades / traderStats.totalTrades) *
                  100
                ).toFixed(1)
              : 0,
          },
        };
      })
    );

    res.json({
      success: true,
      data: tradersWithStats,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update profile
router.put("/profile/update", protect, async (req, res) => {
  try {
    const { username, email, bio, tradingStyle } = req.body;

    // Check if username is taken (if username is being changed)
    if (username !== req.user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: "Username is already taken",
        });
      }
    }

    // Check if email is taken (if email is being changed)
    if (email !== req.user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: "Email is already taken",
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { username, email, bio, tradingStyle },
      { new: true }
    ).select("-password");

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update password
router.put("/profile/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select("+password");

    // Check current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Current password is incorrect",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      data: "Password updated successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/validate", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
});

module.exports = router;
