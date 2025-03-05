// routes/studyGroupRoutes.js
const express = require("express");
const router = express.Router();
const StudyGroup = require("../models/StudyGroup");
const { protect } = require("../middleware/authMiddleware");

// Create a new study group
router.post("/", protect, async (req, res) => {
  try {
    const {
      name,
      description,
      isPrivate,
      joinDeadline,
      tags,
      scheduledDate,
      duration,
      topic,
    } = req.body;

    const studyGroup = await StudyGroup.create({
      name,
      description,
      creator: req.user._id,
      members: [req.user._id],
      isPrivate,
      joinDeadline: joinDeadline ? new Date(joinDeadline) : null,
      tags,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      duration: duration || 60,
      topic: topic || name,
    });

    res.status(201).json({
      success: true,
      data: studyGroup,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get all study groups (that the user has access to)
router.get("/", protect, async (req, res) => {
  try {
    // If user wants to see public groups they're not part of
    const { includePublic } = req.query;

    let query = {
      $or: [
        { members: req.user._id }, // User is a member
        { creator: req.user._id }, // User is the creator
      ],
    };

    if (includePublic === "true") {
      query = {
        $or: [
          query.$or[0],
          query.$or[1],
          { isPrivate: false }, // Public groups
        ],
      };
    }

    const studyGroups = await StudyGroup.find(query)
      .populate("creator", "username")
      .populate("members", "username")
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: studyGroups.length,
      data: studyGroups,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get a single study group
router.get("/:id", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id)
      .populate("creator", "username")
      .populate("members", "username")
      .populate("invitees.user", "username email")
      .populate("messages.sender", "username"); // Add this line

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user has access
    const isMember = studyGroup.members.some(
      (member) => member._id.toString() === req.user._id.toString()
    );
    const isCreator =
      studyGroup.creator._id.toString() === req.user._id.toString();

    if (!isCreator && !isMember && studyGroup.isPrivate) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    res.json({
      success: true,
      data: studyGroup,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update a study group
router.patch("/:id", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is the creator
    if (studyGroup.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: "Only the creator can update this group",
      });
    }

    const { scheduledDate, duration, topic, description } = req.body;

    // If updating event details specifically
    if (scheduledDate !== undefined || duration !== undefined) {
      // Just update the top-level scheduledDate and duration fields
      const updateData = {};

      if (scheduledDate !== undefined) {
        updateData.scheduledDate = new Date(scheduledDate);
      }

      if (duration !== undefined) {
        updateData.duration = duration;
      }

      if (topic !== undefined) {
        updateData.topic = topic;
      }

      if (description !== undefined) {
        updateData.description = description;
      }

      // Update the study group
      const updatedStudyGroup = await StudyGroup.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true, runValidators: true }
      )
        .populate("creator", "username")
        .populate("members", "username")
        .populate("invitees.user", "username email");

      return res.json({
        success: true,
        data: updatedStudyGroup,
      });
    } else {
      // Handle other updates (not time-related)
      // ...
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/:id/messages", protect, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message content is required",
      });
    }

    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is a member
    const isMember = studyGroup.members.some(
      (member) => member.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can send messages to this group",
      });
    }

    // Create the new message
    const newMessage = {
      sender: req.user._id,
      content,
      timestamp: new Date(),
    };

    // Add to the group's messages array
    studyGroup.messages.push(newMessage);
    await studyGroup.save();

    // Return the message with the sender populated
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "messages.sender",
      "username"
    );

    const addedMessage =
      updatedGroup.messages[updatedGroup.messages.length - 1];

    res.status(201).json({
      success: true,
      data: addedMessage,
    });
  } catch (error) {
    console.error("Error adding message:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
