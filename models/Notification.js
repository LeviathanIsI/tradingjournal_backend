const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["system", "message", "invite", "trade", "group", "update"],
      default: "system",
    },
    read: {
      type: Boolean,
      default: false,
    },
    linkTo: {
      type: String,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    expiresAt: {
      type: Date,
      default: () => new Date(+new Date() + 30 * 24 * 60 * 60 * 1000), // Default expiry: 30 days
    },
  },
  {
    timestamps: true,
  }
);

// Create TTL index on expiresAt field to automatically delete expired notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Add static methods
notificationSchema.statics.createNotification = async function (data) {
  return await this.create(data);
};

notificationSchema.statics.markAsRead = async function (id, userId) {
  return await this.findOneAndUpdate(
    { _id: id, user: userId },
    { read: true },
    { new: true }
  );
};

notificationSchema.statics.markAllAsRead = async function (userId) {
  return await this.updateMany({ user: userId, read: false }, { read: true });
};

notificationSchema.statics.getUnreadCount = async function (userId) {
  return await this.countDocuments({ user: userId, read: false });
};

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
