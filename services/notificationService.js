const Notification = require("../models/Notification");
const User = require("../models/User");

/**
 * Notification Service - Utility functions for creating different types of notifications
 */
const notificationService = {
  /**
   * Send a system notification to a user
   * @param {string} userId - The recipient user ID
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} linkTo - Optional URL to navigate to when notification is clicked
   * @returns {Promise<Object>} - The created notification
   */
  sendSystemNotification: async (userId, title, message, linkTo = null) => {
    return await Notification.createNotification({
      user: userId,
      title,
      message,
      type: "system",
      linkTo,
    });
  },

  /**
   * Send a message notification for new messages or mentions
   * @param {string} userId - The recipient user ID
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Object} meta - Additional metadata (e.g., messageId, senderId)
   * @returns {Promise<Object>} - The created notification
   */
  sendMessageNotification: async (userId, title, message, meta = {}) => {
    return await Notification.createNotification({
      user: userId,
      title,
      message,
      type: "message",
      linkTo: meta.messageLink || null,
      meta,
    });
  },

  /**
   * Send a study group invitation notification
   * @param {string} userId - The recipient user ID
   * @param {string} groupId - The study group ID
   * @param {string} groupName - The study group name
   * @param {string} inviterName - The name of the user who sent the invitation
   * @returns {Promise<Object>} - The created notification
   */
  sendGroupInviteNotification: async (
    userId,
    groupId,
    groupName,
    inviterName
  ) => {
    const title = "New Study Group Invitation";
    const message = `${inviterName} invited you to join the study group "${groupName}"`;

    return await Notification.createNotification({
      user: userId,
      title,
      message,
      type: "invite",
      linkTo: `/study-groups/${groupId}`,
      meta: {
        groupId,
        groupName,
        inviterName,
      },
    });
  },

  /**
   * Send a notification about trading activity
   * @param {string} userId - The recipient user ID
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Object} tradeData - Trade related data
   * @returns {Promise<Object>} - The created notification
   */
  sendTradeNotification: async (userId, title, message, tradeData = {}) => {
    return await Notification.createNotification({
      user: userId,
      title,
      message,
      type: "trade",
      linkTo: tradeData.tradeId ? `/trades/${tradeData.tradeId}` : null,
      meta: tradeData,
    });
  },

  /**
   * Send a notification to all study group members
   * @param {Array<string>} memberIds - Array of member user IDs
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} groupId - The group ID
   * @returns {Promise<Array<Object>>} - The created notifications
   */
  sendGroupNotification: async (memberIds, title, message, groupId) => {
    const notificationPromises = memberIds.map((userId) =>
      Notification.createNotification({
        user: userId,
        title,
        message,
        type: "group",
        linkTo: `/study-groups/${groupId}`,
        meta: { groupId },
      })
    );

    return await Promise.all(notificationPromises);
  },

  /**
   * Send notification to users with beta access
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} linkTo - Optional URL to navigate to when notification is clicked
   * @returns {Promise<Array<Object>>} - The created notifications
   */
  sendBetaTesterNotification: async (title, message, linkTo = null) => {
    // Find all beta testers
    const betaTesters = await User.find({
      "specialAccess.hasAccess": true,
      "specialAccess.reason": "Beta Tester",
    }).select("_id");

    const testerIds = betaTesters.map((user) => user._id);

    const notificationPromises = testerIds.map((userId) =>
      Notification.createNotification({
        user: userId,
        title,
        message,
        type: "update",
        linkTo,
        meta: { isBetaFeature: true },
      })
    );

    return await Promise.all(notificationPromises);
  },

  /**
   * Send notification to all users or users with specific feature access
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} linkTo - Optional URL to navigate to
   * @param {string} requiredAccess - Access level required to receive the notification
   * @returns {Promise<number>} - Count of notifications sent
   */
  sendBroadcastNotification: async (
    title,
    message,
    linkTo = null,
    requiredAccess = null
  ) => {
    let query = {};

    // If access requirement specified, only send to users with that access
    if (requiredAccess) {
      query = {
        $or: [
          { "subscription.plan": requiredAccess },
          { "specialAccess.hasAccess": true },
        ],
      };
    }

    const users = await User.find(query).select("_id");
    const userIds = users.map((user) => user._id);

    // Create notifications in batches to avoid overwhelming the DB
    const batchSize = 100;
    let count = 0;

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const notifications = await Promise.all(
        batch.map((userId) =>
          Notification.createNotification({
            user: userId,
            title,
            message,
            type: "system",
            linkTo,
          })
        )
      );
      count += notifications.length;
    }

    return count;
  },
};

module.exports = notificationService;
