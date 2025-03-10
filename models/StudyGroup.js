// models/StudyGroup.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Reply schema for threaded discussions
const replySchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: "User" },
  content: String,
  timestamp: { type: Date, default: Date.now },
  reactions: [
    {
      type: String,
      user: { type: Schema.Types.ObjectId, ref: "User" },
    },
  ],
});

const messageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: "User" },
  content: String,
  timestamp: { type: Date, default: Date.now },
  isPinned: { type: Boolean, default: false },
  attachments: [
    {
      type: String,
      url: String,
    },
  ],
  // Add reactions to messages
  reactions: [
    {
      type: String, // emoji or reaction type
      user: { type: Schema.Types.ObjectId, ref: "User" },
    },
  ],
  // Add replies for threaded discussions
  replies: [replySchema],
});

// Poll schema for group decision making
const pollSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: "User" },
  question: { type: String, required: true },
  options: [
    {
      text: String,
      voters: [{ type: Schema.Types.ObjectId, ref: "User" }],
    },
  ],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date,
});

// RSVP status schema for session attendees
const rsvpSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["attending", "maybe", "not_attending"],
    default: "maybe",
  },
  updatedAt: { type: Date, default: Date.now },
});

const sessionSchema = new Schema({
  topic: String,
  description: String,
  scheduledDate: Date,
  duration: Number, // in minutes
  isCompleted: { type: Boolean, default: false },
  timezone: { type: String, default: "UTC" },
  // Replace simple attendees array with RSVP status
  attendees: [rsvpSchema],
  resources: [
    {
      type: String, // 'trade', 'link', 'file'
      content: String, // trade ID, URL, etc.
      title: String, // Display name for the resource
      description: String, // Optional description
      sharedBy: { type: Schema.Types.ObjectId, ref: "User" },
      sharedAt: { type: Date, default: Date.now },
    },
  ],
  // Add notes field for collaborative session notes
  notes: { type: String, default: "" },
});

// Define member roles
const memberSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: {
    type: String,
    enum: ["creator", "moderator", "member"],
    default: "member",
  },
  joinedAt: { type: Date, default: Date.now },
  // Track activity stats
  activityStats: {
    messagesCount: { type: Number, default: 0 },
    sessionsAttended: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
  },
});

const studyGroupSchema = new Schema(
  {
    name: { type: String, required: true },
    description: String,
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Replace simple members array with memberSchema for roles and stats
    members: [memberSchema],
    scheduledDate: Date,
    duration: Number,
    topic: String,
    // Add default timezone for the group
    timezone: { type: String, default: "UTC" },
    // Track group activity
    lastActive: { type: Date, default: Date.now },
    invitees: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        status: {
          type: String,
          enum: ["pending", "accepted", "declined"],
          default: "pending",
        },
        invitedAt: { type: Date, default: Date.now },
      },
    ],
    isPrivate: { type: Boolean, default: true },
    joinDeadline: Date,
    sessions: [sessionSchema],
    messages: [messageSchema],
    // Add polls for group decision making
    polls: [pollSchema],
    tags: [String],
    // Add category for better organization
    category: {
      type: String,
      enum: [
        "stocks",
        "options",
        "futures",
        "forex",
        "crypto",
        "technical_analysis",
        "fundamental_analysis",
        "risk_management",
        "psychology",
        "general",
        "other",
      ],
      default: "general",
    },
    // For featured/recommended groups
    isFeatured: { type: Boolean, default: false },
    featuredReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    // Add this to track the last time any field was modified
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add virtual for calculating member count (for sorting)
studyGroupSchema.virtual("memberCount").get(function () {
  return this.members?.length || 0;
});

// Add virtual for calculating message count (for sorting by activity)
studyGroupSchema.virtual("messageCount").get(function () {
  return this.messages?.length || 0;
});

// Create indexes for better query performance
studyGroupSchema.index({ creator: 1 });
studyGroupSchema.index({ "members.user": 1 });
studyGroupSchema.index({ tags: 1 });
studyGroupSchema.index({ category: 1 });
studyGroupSchema.index({ isFeatured: 1 });
studyGroupSchema.index({ scheduledDate: 1 }); // For finding upcoming sessions

module.exports = mongoose.model("StudyGroup", studyGroupSchema);
