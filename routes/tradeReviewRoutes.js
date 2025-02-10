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

// Like a review
router.post("/:id/like", protect, async (req, res) => {
  try {
    const review = await TradeReview.findById(req.params.id);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, error: "Review not found" });
    }

    const alreadyLiked = review.likes.includes(req.user._id);
    if (alreadyLiked) {
      review.likes = review.likes.filter((id) => !id.equals(req.user._id));
    } else {
      review.likes.push(req.user._id);
    }

    await review.save();

    // Fetch the updated review with populated data
    const updatedReview = await TradeReview.findById(review._id)
      .populate("trade")
      .populate("user", "username")
      .populate("comments.user", "username");

    res.json({ success: true, data: updatedReview });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Add a comment
router.post("/:id/comments", protect, async (req, res) => {
  try {
    const review = await TradeReview.findById(req.params.id);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, error: "Review not found" });
    }

    review.comments.push({
      user: req.user._id,
      content: req.body.content,
    });

    await review.save();

    // Fetch the updated review with populated data
    const updatedReview = await TradeReview.findById(review._id)
      .populate("trade")
      .populate("user", "username")
      .populate("comments.user", "username");

    res.json({ success: true, data: updatedReview });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete a comment
router.delete("/:reviewId/comments/:commentId", protect, async (req, res) => {
  try {
    const review = await TradeReview.findById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found",
      });
    }

    // Find the comment
    const comment = review.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: "Comment not found",
      });
    }

    // Check if user is authorized to delete
    if (
      !comment.user.equals(req.user._id) &&
      !review.user.equals(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to delete this comment",
      });
    }

    // Remove the comment and save
    comment.deleteOne();
    await review.save();

    // Return populated review
    const updatedReview = await TradeReview.findById(review._id)
      .populate("trade")
      .populate("user", "username")
      .populate("comments.user", "username");

    res.json({
      success: true,
      data: updatedReview,
    });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get featured reviews
router.get("/featured", async (req, res) => {
  try {
    const featuredReviews = await TradeReview.find({
      isPublic: true,
      featured: true,
    })
      .populate("trade")
      .populate("user", "username")
      .populate({
        path: "comments",
        populate: {
          path: "user",
          select: "username",
        },
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: featuredReviews,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get user's reviews
router.get("/user/:userId", protect, async (req, res) => {
  try {
    const reviews = await TradeReview.find({ user: req.params.userId })
      .populate("trade")
      .populate("user", "username")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update review
router.patch("/:id", protect, async (req, res) => {
  try {
    const review = await TradeReview.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found or unauthorized",
      });
    }

    const updatedReview = await TradeReview.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true }
    )
      .populate("trade")
      .populate("user", "username")
      .populate("comments.user", "username");

    res.json({
      success: true,
      data: updatedReview,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete review
router.delete("/:id", protect, async (req, res) => {
  try {
    const review = await TradeReview.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found or unauthorized",
      });
    }

    await review.deleteOne();

    res.json({
      success: true,
      data: { id: req.params.id },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
