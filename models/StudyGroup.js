// models/StudyGroup.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const messageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: "User" },
  content: String,
  timestamp: { type: Date, default: Date.now },
  attachments: [
    {
      type: String,
      url: String,
    },
  ],
});

const sessionSchema = new Schema({
  topic: String,
  description: String,
  scheduledDate: Date,
  duration: Number, // in minutes
  isCompleted: { type: Boolean, default: false },
  attendees: [{ type: Schema.Types.ObjectId, ref: "User" }],
  resources: [
    {
      type: String, // 'trade', 'link', 'file'
      content: String, // trade ID, URL, etc.
      sharedBy: { type: Schema.Types.ObjectId, ref: "User" },
      sharedAt: { type: Date, default: Date.now },
    },
  ],
});

const studyGroupSchema = new Schema(
  {
    name: { type: String, required: true },
    description: String,
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: Schema.Types.ObjectId, ref: "User" }],
    scheduledDate: Date,
    duration: Number,
    topic: String,
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
    tags: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StudyGroup", studyGroupSchema);
