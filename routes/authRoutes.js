const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const passport = require("passport");
const User = require("../models/User");
const Trade = require("../models/Trade");
const OptionTrade = require("../models/OptionTrade");
const { protect } = require("../middleware/authMiddleware");
const TradeReview = require("../models/TradeReview");
const mongoose = require("mongoose");
const stripe = require("../config/stripe");

// Add at the top with your other imports
const sendEmail = async (to, subject, text) => {
  // Implement your email sending logic here
  // You can use nodemailer or another email service
};

// Generate JWT
const generateToken = (id, googleAuth = false, expireAt2AM = true) => {
  let expiresIn;

  if (expireAt2AM) {
    // Calculate time until 2AM next day
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0);

    // Calculate seconds until expiry - JWT requires seconds
    const secondsUntil2AM = Math.floor((tomorrow - now) / 1000);
    expiresIn = secondsUntil2AM;
  } else {
    // Default expiry (5 days)
    expiresIn = "5d";
  }

  return jwt.sign({ id, googleAuth }, process.env.JWT_SECRET, {
    expiresIn,
  });
};

// Stripe webhook handler
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const user = await User.findById(session.metadata.userId);
        if (!user) {
          console.error("User not found with ID:", session.metadata.userId);
          break;
        }

        try {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          // Update user object
          user.subscription = {
            ...user.subscription,
            active: true,
            type: session.metadata.planType,
            stripeSubscriptionId: session.subscription,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: false,
            paymentStatus: "succeeded",
          };

          await user.save();
        } catch (subError) {
          console.error("Error retrieving subscription:", subError);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const user = await User.findOne({
          "subscription.stripeSubscriptionId": subscription.id,
        });

        if (user) {
          user.subscription.currentPeriodEnd = new Date(
            subscription.current_period_end * 1000
          );
          await user.save();
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const user = await User.findOne({
          "subscription.stripeSubscriptionId": subscription.id,
        });

        if (user) {
          user.subscription.active = false;
          user.subscription.type = null;
          user.subscription.stripeSubscriptionId = null;
          user.subscription.currentPeriodEnd = null;
          user.subscription.cancelAtPeriodEnd = false;
          await user.save();
        }
        break;
      }

      case "payment_method.attached": {
        const paymentMethod = event.data.object;
        const user = await User.findOne({
          "subscription.stripeCustomerId": paymentMethod.customer,
        });

        if (user) {
          user.subscription.lastFourDigits = paymentMethod.card.last4;
          await user.save();
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const user = await User.findOne({
          "subscription.stripeCustomerId": invoice.customer,
        });

        if (user) {
          // Update subscription status to reflect failed payment
          user.subscription.paymentStatus = "failed";
          user.subscription.latestInvoiceId = invoice.id;

          // Store payment intent for later use if needed
          user.subscription.latestPaymentIntentId = invoice.payment_intent;

          // Count failed payment attempts
          user.subscription.failedPaymentAttempts =
            (user.subscription.failedPaymentAttempts || 0) + 1;

          // After 3 failed attempts, mark subscription for cancellation
          if (user.subscription.failedPaymentAttempts >= 3) {
            user.subscription.cancelAtPeriodEnd = true;
          }

          await user.save();
        }
        break;
      }
    }

    res.json({ success: true, received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/ai-limits", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Check if reset date has passed
    const now = new Date();
    if (now >= user.aiRequestLimits.nextResetDate) {
      // Reset counter and update next reset date
      const nextMonday = new Date(now);
      const daysUntilMonday = 1 - now.getDay();

      if (daysUntilMonday <= 0) {
        nextMonday.setDate(now.getDate() + 7 + daysUntilMonday);
      } else {
        nextMonday.setDate(now.getDate() + daysUntilMonday);
      }

      nextMonday.setHours(0, 1, 0, 0); // 12:01 AM

      user.aiRequestLimits.nextResetDate = nextMonday;
      user.aiRequestLimits.remainingRequests = user.aiRequestLimits.weeklyLimit;

      await user.save();
    }

    res.json({
      success: true,
      data: {
        aiRequestLimits: user.aiRequestLimits,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching AI limits:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch AI limits",
    });
  }
});

router.post("/create-portal-session", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.subscription.stripeCustomerId) {
      return res.status(400).json({
        success: false,
        error: "No subscription found",
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/settings`,
    });

    res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("Error creating portal session:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add this with your other routes in authRoutes.js
router.post("/cancel-subscription", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: "No active subscription found",
      });
    }

    // Cancel subscription with Stripe
    await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Update user subscription status
    user.subscription.cancelAtPeriodEnd = true;
    await user.save();

    res.json({
      success: true,
      message: "Subscription will be canceled at the end of the billing period",
      data: user.subscription,
    });
  } catch (error) {
    console.error("Error canceling subscription:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Register user
router.post("/register", async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      securityQuestions,
      expireAt2AM = true,
    } = req.body;

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
        aiRequestLimits: user.aiRequestLimits,
        token: generateToken(user._id, false, expireAt2AM),
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password, expireAt2AM = true } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await user.matchPassword(password))) {
      console.warn("⚠️ [Login] Invalid Credentials!");
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        preferences: user.preferences,
        googleAuth: user.googleAuth,
        specialAccess: user.specialAccess,
        aiRequestLimits: user.aiRequestLimits,
        token: generateToken(user._id, user.googleAuth, expireAt2AM),
      },
    });
  } catch (error) {
    console.error("❌ [Login] ERROR:", error);
    res.status(400).json({ success: false, error: error.message });
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
      {
        $addFields: {
          winRate: {
            $cond: [
              { $eq: ["$totalTrades", 0] },
              0,
              {
                $multiply: [
                  { $divide: ["$winningTrades", "$totalTrades"] },
                  100,
                ],
              },
            ],
          },
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
        // Use the same date field that the dashboard uses
        dateFilter = { exitDate: { $gte: startDate } };
      }
    }

    const traders = await User.find().select("-password -email").lean();

    // Get stats for each trader
    const tradersWithStats = await Promise.all(
      traders.map(async (trader) => {
        const traderId = trader._id;

        // For stock trades
        const stockTrades = await Trade.find({
          user: traderId,
          status: "CLOSED",
          ...dateFilter,
        }).lean();

        // For option trades
        const optionTrades = await OptionTrade.find({
          user: traderId,
          status: "CLOSED",
          ...dateFilter,
        }).lean();

        // Combine all trades
        const allTrades = [...stockTrades, ...optionTrades];

        if (allTrades.length === 0) {
          return {
            ...trader,
            stats: {
              totalTrades: 0,
              winningTrades: 0,
              losingTrades: 0,
              totalProfit: 0,
              winRate: 0,
              winLossRatio: 0,
            },
          };
        }

        // Calculate stats
        const winningTrades = allTrades.filter(
          (t) => t.profitLoss.realized > 0
        );
        const losingTrades = allTrades.filter(
          (t) => t.profitLoss.realized <= 0
        );

        const totalProfit = allTrades.reduce(
          (sum, trade) => sum + trade.profitLoss.realized,
          0
        );
        const winRate = (winningTrades.length / allTrades.length) * 100;
        const winLossRatio =
          losingTrades.length > 0
            ? winningTrades.length / losingTrades.length
            : winningTrades.length;

        return {
          ...trader,
          stats: {
            totalTrades: allTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            totalProfit: totalProfit,
            winRate: parseFloat(winRate.toFixed(1)),
            winLossRatio: parseFloat(winLossRatio.toFixed(2)),
          },
        };
      })
    );

    // Sort by total profit (descending)
    const sortedTraders = tradersWithStats.sort(
      (a, b) => (b.stats?.totalProfit || 0) - (a.stats?.totalProfit || 0)
    );

    res.json({
      success: true,
      data: sortedTraders,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Add an endpoint to get the current user's stats that match the dashboard
router.get("/me/stats", protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get stock trades
    const stockTrades = await Trade.find({
      user: userId,
      status: "CLOSED",
    }).lean();

    // Get option trades
    const optionTrades = await OptionTrade.find({
      user: userId,
      status: "CLOSED",
    }).lean();

    // Combine all trades
    const allTrades = [...stockTrades, ...optionTrades];

    // Calculate stats the same way as the dashboard
    const winningTrades = allTrades.filter((t) => t.profitLoss.realized > 0);
    const losingTrades = allTrades.filter((t) => t.profitLoss.realized <= 0);

    const totalProfit = allTrades.reduce(
      (sum, trade) => sum + trade.profitLoss.realized,
      0
    );
    const winRate =
      allTrades.length > 0
        ? (winningTrades.length / allTrades.length) * 100
        : 0;
    const winLossRatio =
      losingTrades.length > 0
        ? winningTrades.length / losingTrades.length
        : winningTrades.length;

    res.json({
      success: true,
      data: {
        totalTrades: allTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        totalProfit: totalProfit,
        winRate: parseFloat(winRate.toFixed(1)),
        winLossRatio: parseFloat(winLossRatio.toFixed(2)),
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

// Add this route to debug leaderboard issues
router.get("/leaderboard-debug", protect, async (req, res) => {
  try {
    // Log user information
    console.log("User requesting debug:", req.user._id);

    // Check if OptionTrade model exists
    console.log("OptionTrade model exists:", !!OptionTrade);

    // Count users
    const userCount = await User.countDocuments();
    console.log("Total users:", userCount);

    // Count trades
    const tradeCount = await Trade.countDocuments();
    console.log("Total trades:", tradeCount);

    // Count option trades
    const optionTradeCount = await OptionTrade.countDocuments();
    console.log("Total option trades:", optionTradeCount);

    // Test a simple aggregation
    const testAggregation = await Trade.aggregate([
      { $match: { user: req.user._id } },
      { $count: "userTradeCount" },
    ]);
    console.log("Test aggregation:", testAggregation);

    res.json({
      success: true,
      debug: {
        userCount,
        tradeCount,
        optionTradeCount,
        testAggregation,
      },
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
      stack: error.stack,
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

// Add this to your validate endpoint temporarily
router.get("/validate", protect, async (req, res) => {
  try {
    // Fetch user with all necessary fields including specialAccess
    const user = await User.findById(req.user._id)
      .select("-password")
      .select("+specialAccess"); // Explicitly select specialAccess field

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Ensure specialAccess is present
    if (!user.specialAccess) {
      user.specialAccess = {
        hasAccess: false,
        expiresAt: null,
        reason: "other",
      };
      // Save the updated user document with default fields
      await user.save();
    }

    // Also ensure subscription data is complete
    if (!user.subscription) {
      user.subscription = {
        active: false,
        type: null,
        cancelAtPeriodEnd: false,
        paymentStatus: "active",
        failedPaymentAttempts: 0,
      };
      await user.save();
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("❌ Validate Error:", error);
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

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Get both followers and following
    const networkUsers = await User.find({
      $or: [{ _id: { $in: user.followers } }, { _id: { $in: user.following } }],
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
    console.error("Network data fetch error:", error);
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

// Single Google OAuth initialization route
router.get(
  "/google",
  (req, res, next) => {
    // Save the expireAt2AM preference in the session or state if needed
    const expireAt2AM = req.query.expireAt2AM === "true";
    // You might need to store this in a session or modify the auth state
    next();
  },
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account",
    accessType: "online",
  })
);

// Single Google OAuth callback route
router.get(
  "/google/callback",
  async (req, res, next) => {
    next();
  },
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  async (req, res) => {
    try {
      if (!req.user) {
        console.error("❌ No user object returned from Google authentication");
        throw new Error("No user returned from authentication.");
      }

      // Check if expireAt2AM was requested in the original auth request
      // This comes from the query param you'd add to the Google auth URL
      const expireAt2AM = req.query.expireAt2AM === "true";
      const token = generateToken(req.user._id, true, expireAt2AM);

      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(`${FRONTEND_URL}/auth/google/success?token=${token}`);
    } catch (error) {
      console.error("❌ Google OAuth Callback Error:", error);
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
      res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
    }
  }
);

// Also update the initial Google auth route
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account", // Force account selection
    accessType: "online", // Don't persist access
  })
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

    // We're handling a token from the callback, so maintain the same expiry as what was set there
    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        preferences: user.preferences,
        googleAuth: user.googleAuth,
        token: token, // Just pass through the same token that was received
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

// Update the delete account route in authRoutes.js
// In authRoutes.js
router.delete("/delete-account", protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Delete all trade reviews created by this user
    await TradeReview.deleteMany({ user: userId });

    // 2. Delete all trade plans created by this user
    await TradePlan.deleteMany({ user: userId });

    // 3. Delete all trades created by this user
    await Trade.deleteMany({ user: userId });

    // 4. If using Stripe, handle subscription cancellation
    if (req.user.subscription?.stripeCustomerId) {
      try {
        // Cancel any active subscriptions but don't provide refunds
        const subscriptions = await stripe.subscriptions.list({
          customer: req.user.subscription.stripeCustomerId,
          status: "active",
        });

        for (const subscription of subscriptions.data) {
          await stripe.subscriptions.update(subscription.id, {
            cancel_at_period_end: true,
          });
        }
      } catch (stripeError) {
        console.error("Stripe error during account deletion:", stripeError);
      }
    }

    // 5. Finally delete the user
    await User.findByIdAndDelete(userId);

    res
      .status(200)
      .json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error in delete account:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create checkout session
// Modified create-subscription route
router.post("/create-subscription", protect, async (req, res) => {
  try {
    const { planType, isReactivation } = req.body;
    const user = await User.findById(req.user._id);

    // If subscription is marked for cancellation, we want to allow a new subscription
    if (user.subscription.active && !user.subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        success: false,
        error: "User already has an active subscription",
      });
    }

    // Create or get Stripe customer
    let customerId = user.subscription.stripeCustomerId;
    let needNewCustomer = false;

    // Check if we need to create a new customer
    // This could be because:
    // 1. No customer ID exists yet
    // 2. The customer ID is from test mode (starts with 'cus_' and can't be found in live mode)
    if (!customerId) {
      needNewCustomer = true;
    } else {
      try {
        // Try to retrieve the customer to see if it exists in the current environment
        await stripe.customers.retrieve(customerId);
      } catch (stripeError) {
        // If we get a "no such customer" error or any other error, create a new customer
        console.log(`Customer retrieval error: ${stripeError.message}`);
        needNewCustomer = true;
      }
    }

    // Create a new customer if needed
    if (needNewCustomer) {
      try {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: {
            userId: user._id.toString(),
          },
        });
        customerId = customer.id;

        // Save the new customer ID to the user record
        user.subscription.stripeCustomerId = customerId;
        await user.save();
      } catch (createError) {
        console.error("Error creating customer:", createError);
        return res.status(500).json({
          success: false,
          error: "Failed to create customer",
        });
      }
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price:
            planType === "yearly"
              ? process.env.STRIPE_YEARLY_PRICE_ID
              : process.env.STRIPE_MONTHLY_PRICE_ID,
          quantity: 1,
        },
      ],
      metadata: {
        userId: user._id.toString(),
        planType,
        isReactivation: isReactivation ? "true" : "false",
      },
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/settings?canceled=true`,
    });

    res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("Subscription error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get subscription status
router.get("/subscription", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      data: user.subscription,
    });
  } catch (error) {
    console.error("Subscription fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch subscription status",
    });
  }
});

// Cancel subscription
router.post("/cancel-subscription", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: "No active subscription found",
      });
    }

    // Cancel at period end
    await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    user.subscription.cancelAtPeriodEnd = true;
    await user.save();

    res.json({
      success: true,
      message: "Subscription will be canceled at the end of the billing period",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update subscription plan
router.post("/update-subscription", protect, async (req, res) => {
  try {
    const { planType } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: "No active subscription found",
      });
    }

    // Get the current subscription
    const subscription = await stripe.subscriptions.retrieve(
      user.subscription.stripeSubscriptionId
    );

    // Update the subscription with the new price
    const updatedSubscription = await stripe.subscriptions.update(
      user.subscription.stripeSubscriptionId,
      {
        items: [
          {
            id: subscription.items.data[0].id,
            price:
              planType === "yearly"
                ? process.env.STRIPE_YEARLY_PRICE_ID
                : process.env.STRIPE_MONTHLY_PRICE_ID,
          },
        ],
        proration_behavior: "always_invoice", // or 'create_prorations'
        payment_behavior: "error_if_incomplete",
      }
    );

    // Update user in database
    user.subscription.type = planType;
    user.subscription.currentPeriodEnd = new Date(
      updatedSubscription.current_period_end * 1000
    );
    await user.save();

    res.json({
      success: true,
      data: user.subscription,
    });
  } catch (error) {
    console.error("Error updating subscription:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Reactivate canceled subscription
router.post("/reactivate-subscription", protect, async (req, res) => {
  try {
    const { planType } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: "No subscription found to reactivate",
      });
    }

    // If subscription was canceled but still active (cancelAtPeriodEnd)
    if (user.subscription.cancelAtPeriodEnd) {
      // First get the current subscription
      const currentSubscription = await stripe.subscriptions.retrieve(
        user.subscription.stripeSubscriptionId
      );

      // Then update it
      const subscription = await stripe.subscriptions.update(
        user.subscription.stripeSubscriptionId,
        {
          cancel_at_period_end: false,
          proration_behavior: "always_invoice",
          items: [
            {
              id: currentSubscription.items.data[0].id,
              price:
                planType === "yearly"
                  ? process.env.STRIPE_YEARLY_PRICE_ID
                  : process.env.STRIPE_MONTHLY_PRICE_ID,
            },
          ],
        }
      );

      user.subscription.cancelAtPeriodEnd = false;
      user.subscription.type = planType;
      await user.save();

      return res.json({
        success: true,
        message: "Subscription reactivated successfully",
        data: user.subscription,
      });
    }
    // If subscription has already ended, create new checkout session
    else {
      const session = await stripe.checkout.sessions.create({
        customer: user.subscription.stripeCustomerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price:
              planType === "yearly"
                ? process.env.STRIPE_YEARLY_PRICE_ID
                : process.env.STRIPE_MONTHLY_PRICE_ID,
            quantity: 1,
          },
        ],
        metadata: {
          userId: user._id.toString(),
          planType,
          isReactivation: "true",
        },
        success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/settings?canceled=true`,
      });

      return res.json({
        success: true,
        url: session.url,
      });
    }
  } catch (error) {
    console.error("Error reactivating subscription:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// In your auth routes file
router.get("/me/special-access", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("specialAccess");

    // Check if user has valid special access
    const hasSpecialAccess =
      user.specialAccess &&
      user.specialAccess.hasAccess &&
      (!user.specialAccess.expiresAt ||
        new Date() < new Date(user.specialAccess.expiresAt));

    res.json({
      success: true,
      hasSpecialAccess,
    });
  } catch (error) {
    console.error("Error checking special access:", error);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
