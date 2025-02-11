const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const passport = require("passport");
const User = require("../models/User");
const Trade = require("../models/Trade");
const { protect } = require("../middleware/authMiddleware");
const TradeReview = require("../models/TradeReview");

// Generate JWT
const generateToken = (id, googleAuth = false, rememberMe = false) => {
  const expiresIn = rememberMe ? "5d" : "2h";
  return jwt.sign({ id, googleAuth }, process.env.JWT_SECRET, {
    expiresIn,
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, securityQuestions } = req.body;

    if (await User.findOne({ email })) {
      return res.status(400).json({
        success: false,
        error: "User already exists",
      });
    }

    const user = await User.create({
      username,
      email,
      password,
      securityQuestions: {
        question1: {
          question: securityQuestions.question1.question,
          answer: securityQuestions.question1.answer,
        },
        question2: {
          question: securityQuestions.question2.question,
          answer: securityQuestions.question2.answer,
        },
        question3: {
          question: securityQuestions.question3.question,
          answer: securityQuestions.question3.answer,
        },
      },
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
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

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await user.matchPassword(password))) {
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
        googleAuth: user.googleAuth,
        token: generateToken(user._id, user.googleAuth, rememberMe),
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
    const { startingCapital, defaultCurrency, timeZone, experienceLevel } =
      req.body.preferences;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { preferences: req.body.preferences },
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
    const { username, email, bio, tradingStyle, timeZone } = req.body;

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
      { username, email, bio, tradingStyle, timeZone },
      { new: true, runValidators: true }
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

// Get network data
router.get("/network/:userId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    // Get both followers and following
    const networkUsers = await User.find({
      $or: [
        { _id: { $in: user.followers } }, // Users who follow this user
        { _id: { $in: user.following } }, // Users this user follows
      ],
    }).select("-password -email");

    // Get stats for each user in the network
    const networkData = await Promise.all(
      networkUsers.map(async (networkUser) => {
        const stats = await Trade.aggregate([
          { $match: { user: networkUser._id } },
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

        return {
          ...networkUser.toObject(),
          stats: stats[0] || {
            totalTrades: 0,
            winningTrades: 0,
            totalProfit: 0,
          },
          relationship: {
            isFollower: user.followers.includes(networkUser._id),
            isFollowing: user.following.includes(networkUser._id),
          },
        };
      })
    );

    res.json({
      success: true,
      data: networkData,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Initiate password reset
router.post("/forgot-password/init", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Return security questions
    res.json({
      success: true,
      data: {
        userId: user._id,
        questions: {
          question1: user.securityQuestions.question1.question,
          question2: user.securityQuestions.question2.question,
          question3: user.securityQuestions.question3.question,
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

// Set up or update security questions
router.post("/security-questions", protect, async (req, res) => {
  try {
    const { questions } = req.body;
    const user = await User.findById(req.user._id);

    // Encrypt answers before saving
    user.securityQuestions = {
      question1: {
        question: questions.question1.question,
        answer: await user.encryptSecurityAnswer(questions.question1.answer),
      },
      question2: {
        question: questions.question2.question,
        answer: await user.encryptSecurityAnswer(questions.question2.answer),
      },
      question3: {
        question: questions.question3.question,
        answer: await user.encryptSecurityAnswer(questions.question3.answer),
      },
    };

    await user.save();

    res.json({
      success: true,
      message: "Security questions updated successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Verify security answers and generate reset token
router.post("/forgot-password/verify", async (req, res) => {
  try {
    const { userId, answers } = req.body;
    const user = await User.findById(userId).select(
      "+securityQuestions.question1.answer " +
        "+securityQuestions.question2.answer " +
        "+securityQuestions.question3.answer"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Verify all three answers
    const isAnswer1Correct = await user.verifySecurityAnswer(
      "question1",
      answers.answer1
    );
    const isAnswer2Correct = await user.verifySecurityAnswer(
      "question2",
      answers.answer2
    );
    const isAnswer3Correct = await user.verifySecurityAnswer(
      "question3",
      answers.answer3
    );

    if (!isAnswer1Correct || !isAnswer2Correct || !isAnswer3Correct) {
      return res.status(401).json({
        success: false,
        error: "Incorrect answers",
      });
    }

    // Generate password reset token
    const resetToken = jwt.sign(
      { id: user._id, type: "reset" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    res.json({
      success: true,
      data: {
        resetToken,
      },
    });
  } catch (error) {
    console.error("Verify error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Add this to your authRoutes.js file
// Reset password with token
router.put("/set-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // If the user signed up with Google and has no password, allow setting a new password directly
    if (user.googleAuth) {
      user.password = newPassword;
      user.googleAuth = false; // Update googleAuth to false
      await user.save();
      return res.json({
        success: true,
        message: "Password set successfully",
        data: user,
      });
    }

    // If the user has an existing password, require the current password for security
    if (!user.password || !(await user.matchPassword(currentPassword))) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid current password" });
    }

    user.password = newPassword;
    await user.save();
    res.json({
      success: true,
      message: "Password updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put("/set-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // If the user signed up with Google and has no password, allow setting a new password directly
    if (user.googleAuth) {
      user.password = newPassword;
      await user.save();
      return res.json({ success: true, message: "Password set successfully" });
    }

    // If the user has an existing password, require the current password for security
    if (!user.password || !(await user.matchPassword(currentPassword))) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid current password" });
    }

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Initiate Google OAuth flow
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

// Google OAuth callback
// Google OAuth callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${
      process.env.FRONTEND_URL || "http://localhost:5173"
    }/login`,
  }),
  async (req, res) => {
    try {
      if (!req.user) {
        throw new Error("No user returned from Google authentication");
      }

      let user = await User.findOne({ googleId: req.user.googleId });

      if (!user) {
        user = await User.create({
          username: req.user.username,
          email: req.user.email,
          googleId: req.user.googleId,
          googleAuth: true,
        });
      } else {
        user.googleAuth = true;
        await user.save();
      }

      const token = jwt.sign(
        { id: user._id, googleAuth: true },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      // 🔹 Dynamically redirect to the correct environment
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(`${FRONTEND_URL}/auth/google/success?token=${token}`);
    } catch (error) {
      console.error("Google callback error:", error);
      res.redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:5173"
        }/login?error=google_callback_failed`
      );
    }
  }
);

// Handle successful Google sign-in on frontend
router.get("/google/success", async (req, res) => {
  try {
    const { token } = req.query;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      throw new Error("User not found");
    }

    const rememberMe = req.query.rememberMe === "true";

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        preferences: user.preferences,
        googleAuth: user.googleAuth,
        token: generateToken(user._id, user.googleAuth, rememberMe),
      },
    });
  } catch (error) {
    console.error("Error in success handler:", error);
    res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
});

module.exports = router;
