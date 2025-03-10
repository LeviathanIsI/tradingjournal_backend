// routes/studyGroupRoutes.js
const express = require("express");
const router = express.Router();
const StudyGroup = require("../models/StudyGroup");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { adminProtect } = require("../middleware/adminMiddleware");

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
      category,
      timezone,
    } = req.body;

    // Create the study group with the initial member set to creator with creator role
    const studyGroup = await StudyGroup.create({
      name,
      description,
      creator: req.user._id,
      members: [
        {
          user: req.user._id,
          role: "creator",
          joinedAt: new Date(),
          activityStats: {
            messagesCount: 0,
            sessionsAttended: 0,
            lastActive: new Date(),
          },
        },
      ],
      isPrivate: isPrivate === undefined ? true : isPrivate,
      joinDeadline: joinDeadline ? new Date(joinDeadline) : null,
      tags,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      duration: duration || 60,
      topic: topic || name,
      category: category || "general",
      timezone: timezone || "UTC",
      lastActive: new Date(),
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
    const { includePublic, category, featured } = req.query;

    let query = {};

    // Base query: find groups where user is a member or creator
    const baseQuery = {
      $or: [
        { "members.user": req.user._id }, // User is a member
        { creator: req.user._id }, // User is the creator
      ],
    };

    // Include public groups if requested
    if (includePublic === "true") {
      query = {
        $or: [
          ...baseQuery.$or,
          { isPrivate: false }, // Public groups
        ],
      };
    } else {
      query = baseQuery;
    }

    // Filter by category if specified
    if (category && category !== "all") {
      query.category = category;
    }

    // Filter for featured groups if specified
    if (featured === "true") {
      query.isFeatured = true;
    }

    const studyGroups = await StudyGroup.find(query)
      .populate("creator", "username")
      .populate("members.user", "username")
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
      .populate("members.user", "username")
      .populate("invitees.user", "username email")
      .populate("messages.sender", "username")
      .populate("messages.reactions.user", "username")
      .populate("messages.replies.sender", "username")
      .populate("polls.creator", "username")
      .populate("polls.options.voters", "username");

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user has access
    const isMember = studyGroup.members.some(
      (member) => member.user._id.toString() === req.user._id.toString()
    );
    const isCreator =
      studyGroup.creator._id.toString() === req.user._id.toString();

    if (!isCreator && !isMember && studyGroup.isPrivate) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
      });
    }

    // Update last active time for the user in this group
    if (isMember) {
      await StudyGroup.findOneAndUpdate(
        {
          _id: req.params.id,
          "members.user": req.user._id,
        },
        {
          $set: {
            "members.$.activityStats.lastActive": new Date(),
          },
        }
      );
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

    // Check if user is the creator or a moderator
    const isCreator = studyGroup.creator.toString() === req.user._id.toString();
    const isModerator = studyGroup.members.some(
      (member) =>
        member.user.toString() === req.user._id.toString() &&
        member.role === "moderator"
    );

    if (!isCreator && !isModerator) {
      return res.status(403).json({
        success: false,
        error: "Only the creator or moderators can update this group",
      });
    }

    const {
      scheduledDate,
      duration,
      topic,
      description,
      category,
      timezone,
      tags,
      isPrivate,
    } = req.body;

    // Create update object with only provided fields
    const updateData = {};

    if (scheduledDate !== undefined)
      updateData.scheduledDate = new Date(scheduledDate);
    if (duration !== undefined) updateData.duration = duration;
    if (topic !== undefined) updateData.topic = topic;
    if (description !== undefined) updateData.description = description;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (tags !== undefined) updateData.tags = tags;

    // Some fields should only be modifiable by the creator
    if (isCreator) {
      if (category !== undefined) updateData.category = category;
      if (isPrivate !== undefined) updateData.isPrivate = isPrivate;
    }

    // Update the lastActive timestamp
    updateData.lastActive = new Date();

    // Update the study group
    const updatedStudyGroup = await StudyGroup.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("creator", "username")
      .populate("members.user", "username")
      .populate("invitees.user", "username email");

    return res.json({
      success: true,
      data: updatedStudyGroup,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Add a message to a study group
router.post("/:id/messages", protect, async (req, res) => {
  try {
    const { content, replyTo } = req.body;

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
    const memberIndex = studyGroup.members.findIndex(
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (memberIndex === -1) {
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
      reactions: [],
      replies: [],
    };

    // If this is a reply, find the parent message and add it there
    if (replyTo) {
      const parentMessageIndex = studyGroup.messages.findIndex(
        (msg) => msg._id.toString() === replyTo
      );

      if (parentMessageIndex === -1) {
        return res.status(404).json({
          success: false,
          error: "Parent message not found",
        });
      }

      // Add as reply to parent message
      studyGroup.messages[parentMessageIndex].replies.push(newMessage);
    } else {
      // Add as a new top-level message
      studyGroup.messages.push(newMessage);
    }

    // Update member's message count and lastActive
    studyGroup.members[memberIndex].activityStats.messagesCount += 1;
    studyGroup.members[memberIndex].activityStats.lastActive = new Date();

    // Update group's lastActive time
    studyGroup.lastActive = new Date();

    await studyGroup.save();

    // Return the message with the sender populated
    const updatedGroup = await StudyGroup.findById(req.params.id)
      .populate("messages.sender", "username")
      .populate("messages.replies.sender", "username");

    let addedMessage;
    if (replyTo) {
      const parentMessage = updatedGroup.messages.find(
        (msg) => msg._id.toString() === replyTo
      );
      addedMessage = parentMessage.replies[parentMessage.replies.length - 1];
    } else {
      addedMessage = updatedGroup.messages[updatedGroup.messages.length - 1];
    }

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

// Add/remove reaction to a message
router.post("/:id/messages/:messageId/reactions", protect, async (req, res) => {
  try {
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({
        success: false,
        error: "Emoji is required",
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
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can react to messages",
      });
    }

    // Find the message
    const messageIndex = studyGroup.messages.findIndex(
      (msg) => msg._id.toString() === req.params.messageId
    );

    if (messageIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    // Check if user already reacted with this emoji
    const reactionIndex = studyGroup.messages[messageIndex].reactions.findIndex(
      (reaction) =>
        reaction.type === emoji &&
        reaction.user.toString() === req.user._id.toString()
    );

    if (reactionIndex > -1) {
      // Remove the reaction
      studyGroup.messages[messageIndex].reactions.splice(reactionIndex, 1);
    } else {
      // Add the reaction
      studyGroup.messages[messageIndex].reactions.push({
        type: emoji,
        user: req.user._id,
      });
    }

    // Update lastActive times
    studyGroup.lastActive = new Date();

    await studyGroup.save();

    // Get updated message
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "messages.reactions.user",
      "username"
    );

    const updatedMessage = updatedGroup.messages[messageIndex];

    res.json({
      success: true,
      data: updatedMessage,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Pin/unpin a message
router.post("/:id/messages/:messageId/pin", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is the creator or a moderator
    const isCreator = studyGroup.creator.toString() === req.user._id.toString();
    const isModerator = studyGroup.members.some(
      (member) =>
        member.user.toString() === req.user._id.toString() &&
        member.role === "moderator"
    );

    if (!isCreator && !isModerator) {
      return res.status(403).json({
        success: false,
        error: "Only the creator or moderators can pin messages",
      });
    }

    // Find the message
    const messageIndex = studyGroup.messages.findIndex(
      (msg) => msg._id.toString() === req.params.messageId
    );

    if (messageIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    // Toggle pin status
    studyGroup.messages[messageIndex].isPinned =
      !studyGroup.messages[messageIndex].isPinned;

    await studyGroup.save();

    res.json({
      success: true,
      data: studyGroup.messages[messageIndex],
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Create a poll
router.post("/:id/polls", protect, async (req, res) => {
  try {
    const { question, options } = req.body;

    if (
      !question ||
      !options ||
      !Array.isArray(options) ||
      options.length < 2
    ) {
      return res.status(400).json({
        success: false,
        error: "Question and at least 2 options are required",
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
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can create polls",
      });
    }

    // Create the new poll
    const newPoll = {
      creator: req.user._id,
      question,
      options: options.map((text) => ({
        text,
        voters: [],
      })),
      isActive: true,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days expiry
    };

    // Add poll to group
    studyGroup.polls.push(newPoll);

    // Also create a message about the poll
    const pollMessage = {
      sender: req.user._id,
      content: `Poll: ${question}`,
      timestamp: new Date(),
      isPoll: true,
      pollRef: newPoll._id,
    };

    studyGroup.messages.push(pollMessage);

    // Update group and member lastActive
    studyGroup.lastActive = new Date();

    // Update member's message count
    const memberIndex = studyGroup.members.findIndex(
      (member) => member.user.toString() === req.user._id.toString()
    );
    studyGroup.members[memberIndex].activityStats.messagesCount += 1;
    studyGroup.members[memberIndex].activityStats.lastActive = new Date();

    await studyGroup.save();

    // Get the added poll with populated fields
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "polls.creator",
      "username"
    );

    const addedPoll = updatedGroup.polls[updatedGroup.polls.length - 1];

    res.status(201).json({
      success: true,
      data: addedPoll,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Vote in a poll
router.post("/:id/polls/:pollId/vote", protect, async (req, res) => {
  try {
    const { optionIndex } = req.body;

    if (optionIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: "Option index is required",
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
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can vote in polls",
      });
    }

    // Find the poll
    const pollIndex = studyGroup.polls.findIndex(
      (poll) => poll._id.toString() === req.params.pollId
    );

    if (pollIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Poll not found",
      });
    }

    const poll = studyGroup.polls[pollIndex];

    // Check if poll is active
    if (!poll.isActive) {
      return res.status(400).json({
        success: false,
        error: "Poll is closed",
      });
    }

    // Check if option index is valid
    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({
        success: false,
        error: "Invalid option index",
      });
    }

    // Remove user from any previous votes in this poll
    poll.options.forEach((option) => {
      const voterIndex = option.voters.findIndex(
        (voter) => voter.toString() === req.user._id.toString()
      );

      if (voterIndex !== -1) {
        option.voters.splice(voterIndex, 1);
      }
    });

    // Add user to selected option
    poll.options[optionIndex].voters.push(req.user._id);

    await studyGroup.save();

    // Get updated poll with populated fields
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "polls.options.voters",
      "username"
    );

    const updatedPoll = updatedGroup.polls[pollIndex];

    res.json({
      success: true,
      data: updatedPoll,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Update member role (promote/demote)
router.patch("/:id/members/:memberId/role", protect, async (req, res) => {
  try {
    const { role } = req.body;

    if (!role || !["creator", "moderator", "member"].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Valid role is required (moderator or member)",
      });
    }

    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Only creator can change roles
    const isCreator = studyGroup.creator.toString() === req.user._id.toString();

    if (!isCreator) {
      return res.status(403).json({
        success: false,
        error: "Only the creator can update member roles",
      });
    }

    // Cannot change creator role
    if (studyGroup.creator.toString() === req.params.memberId) {
      return res.status(400).json({
        success: false,
        error: "Cannot change creator role",
      });
    }

    // Find the member
    const memberIndex = studyGroup.members.findIndex(
      (member) => member.user.toString() === req.params.memberId
    );

    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Member not found",
      });
    }

    // Update the role
    studyGroup.members[memberIndex].role = role;

    await studyGroup.save();

    // Get updated member data
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "members.user",
      "username"
    );

    res.json({
      success: true,
      data: updatedGroup.members[memberIndex],
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Remove a member from a group
router.delete("/:id/members/:memberId", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is the creator, a moderator, or removing themselves
    const isCreator = studyGroup.creator.toString() === req.user._id.toString();
    const isModerator = studyGroup.members.some(
      (member) =>
        member.user.toString() === req.user._id.toString() &&
        member.role === "moderator"
    );
    const isSelfRemoval = req.params.memberId === req.user._id.toString();

    // Cannot remove the creator
    if (studyGroup.creator.toString() === req.params.memberId) {
      return res.status(400).json({
        success: false,
        error: "Cannot remove the creator from the group",
      });
    }

    // Check permissions
    if (!isCreator && !isModerator && !isSelfRemoval) {
      return res.status(403).json({
        success: false,
        error: "You don't have permission to remove this member",
      });
    }

    // Find and remove the member
    const memberIndex = studyGroup.members.findIndex(
      (member) => member.user.toString() === req.params.memberId
    );

    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Member not found",
      });
    }

    studyGroup.members.splice(memberIndex, 1);

    await studyGroup.save();

    res.json({
      success: true,
      message: "Member removed successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Invite a user to a group
router.post("/:id/invite", protect, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
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
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can invite others",
      });
    }

    // Find user by email
    const invitedUser = await User.findOne({ email });

    if (!invitedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Check if user is already a member
    const isAlreadyMember = studyGroup.members.some(
      (member) => member.user.toString() === invitedUser._id.toString()
    );

    if (isAlreadyMember) {
      return res.status(400).json({
        success: false,
        error: "User is already a member",
      });
    }

    // Check if user is already invited
    const isAlreadyInvited = studyGroup.invitees.some(
      (invite) => invite.user.toString() === invitedUser._id.toString()
    );

    if (isAlreadyInvited) {
      return res.status(400).json({
        success: false,
        error: "User is already invited",
      });
    }

    // Add to invitees
    studyGroup.invitees.push({
      user: invitedUser._id,
      status: "pending",
      invitedAt: new Date(),
    });

    await studyGroup.save();

    // TODO: Send invitation email/notification to user

    // Return updated invitees list
    const updatedGroup = await StudyGroup.findById(req.params.id).populate(
      "invitees.user",
      "username email"
    );

    res.status(201).json({
      success: true,
      data: updatedGroup.invitees,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Respond to an invitation
router.post("/:id/respond-invite", protect, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !["accepted", "declined"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Valid status is required (accepted or declined)",
      });
    }

    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is invited
    const inviteIndex = studyGroup.invitees.findIndex(
      (invite) => invite.user.toString() === req.user._id.toString()
    );

    if (inviteIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Invitation not found",
      });
    }

    // Update invitation status
    studyGroup.invitees[inviteIndex].status = status;

    // If accepted, add user as a member
    if (status === "accepted") {
      // Check if already a member
      const isAlreadyMember = studyGroup.members.some(
        (member) => member.user.toString() === req.user._id.toString()
      );

      if (!isAlreadyMember) {
        studyGroup.members.push({
          user: req.user._id,
          role: "member",
          joinedAt: new Date(),
          activityStats: {
            messagesCount: 0,
            sessionsAttended: 0,
            lastActive: new Date(),
          },
        });
      }
    }

    await studyGroup.save();

    res.json({
      success: true,
      data: {
        status,
        group: studyGroup._id,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Feature a study group (admin only)
router.patch("/:id/feature", adminProtect, async (req, res) => {
  try {
    const { isFeatured, featuredReason } = req.body;

    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Update featured status
    studyGroup.isFeatured = isFeatured === undefined ? true : isFeatured;
    if (featuredReason) {
      studyGroup.featuredReason = featuredReason;
    }

    await studyGroup.save();

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

// RSVP for a session
router.post("/:id/rsvp", protect, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !["attending", "maybe", "not_attending"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Valid status is required (attending, maybe, or not_attending)",
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
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can RSVP",
      });
    }

    // Check if group has a scheduled date
    if (!studyGroup.scheduledDate) {
      return res.status(400).json({
        success: false,
        error: "Group doesn't have a scheduled session",
      });
    }

    // Use the first session or create one if none exists
    if (studyGroup.sessions.length === 0) {
      studyGroup.sessions.push({
        topic: studyGroup.topic || studyGroup.name,
        description: studyGroup.description,
        scheduledDate: studyGroup.scheduledDate,
        duration: studyGroup.duration || 60,
        timezone: studyGroup.timezone,
        attendees: [],
      });
    }

    // Work with the first session (since there should only be one)
    const session = studyGroup.sessions[0];

    // Initialize attendees array if it doesn't exist
    if (!session.attendees) {
      session.attendees = [];
    }

    // Find existing RSVP if any
    const attendeeIndex = session.attendees.findIndex(
      (attendee) => attendee.user.toString() === req.user._id.toString()
    );

    if (attendeeIndex === -1) {
      // Add new RSVP
      session.attendees.push({
        user: req.user._id,
        status,
        updatedAt: new Date(),
      });
    } else {
      // Update existing RSVP
      session.attendees[attendeeIndex].status = status;
      session.attendees[attendeeIndex].updatedAt = new Date();
    }

    await studyGroup.save();

    // Return updated session with attendees
    const updatedGroup = await StudyGroup.findById(req.params.id);

    // We don't populate here to avoid the error about strict population

    res.json({
      success: true,
      data: updatedGroup.sessions[0].attendees,
    });
  } catch (error) {
    console.error("RSVP Error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Get featured groups
router.get("/featured", protect, async (req, res) => {
  try {
    const featuredGroups = await StudyGroup.find({ isFeatured: true })
      .populate("creator", "username")
      .populate("members.user", "username")
      .sort({ updatedAt: -1 })
      .limit(6);

    res.json({
      success: true,
      count: featuredGroups.length,
      data: featuredGroups,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete a study group (creator or admin only)
router.delete("/:id", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is the creator
    const isCreator = studyGroup.creator.toString() === req.user._id.toString();

    // Check if user is an admin (using special access)
    const isAdmin =
      req.user.specialAccess?.hasAccess &&
      req.user.specialAccess?.reason === "Admin";

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Only the creator or an admin can delete this group",
      });
    }

    await StudyGroup.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Study group deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/:id/available-users", protect, async (req, res) => {
  try {
    const studyGroup = await StudyGroup.findById(req.params.id);

    if (!studyGroup) {
      return res.status(404).json({
        success: false,
        error: "Study group not found",
      });
    }

    // Check if user is a member
    const isMember = studyGroup.members.some(
      (member) => member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: "Only members can view available users",
      });
    }

    // Get all existing member IDs
    const existingMemberIds = studyGroup.members.map((member) =>
      member.user.toString()
    );

    // Get all existing invitee IDs
    const existingInviteeIds = studyGroup.invitees.map((invitee) =>
      invitee.user.toString()
    );

    // Find all users who are not already members or invitees
    const availableUsers = await User.find({
      _id: {
        $nin: [...existingMemberIds, ...existingInviteeIds],
      },
    }).select("username email");

    res.json({
      success: true,
      count: availableUsers.length,
      data: availableUsers,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
