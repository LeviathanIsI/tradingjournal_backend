const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["announcement", "alert", "update", "personal", "system"],
      default: "system",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },
    read: {
      type: Boolean,
      default: false,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    adminMessage: {
      type: Boolean,
      default: false,
    },
    link: {
      type: String,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Add index for performance
notificationSchema.index({ user: 1, read: 1 });

// Create TTL index for expiring notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
