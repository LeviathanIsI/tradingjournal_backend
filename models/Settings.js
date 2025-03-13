const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    maintenanceMode: {
      enabled: {
        type: Boolean,
        default: false,
      },
      message: {
        type: String,
        default:
          "The site is currently undergoing scheduled maintenance. Please check back shortly.",
      },
    },
    allowNewRegistrations: {
      type: Boolean,
      default: true,
    },
    defaultUserSubscriptionDays: {
      type: Number,
      default: 7,
    },
    enabledFeatures: {
      aiAssistant: {
        type: Boolean,
        default: true,
      },
      communityFeatures: {
        type: Boolean,
        default: true,
      },
      tradingAnalytics: {
        type: Boolean,
        default: true,
      },
      studyGroups: {
        type: Boolean,
        default: false,
      },
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Method to ensure there's only one settings document
SettingsSchema.statics.getSettings = async function () {
  try {

    // First, try to find existing settings
    let settings = await this.findOne();

    // If settings exist, return them
    if (settings) {
      return settings;
    }

    // If no settings exist, create default settings
    settings = await this.create({
      maintenanceMode: {
        enabled: false,
        message:
          "The site is currently undergoing scheduled maintenance. Please check back shortly.",
      },
      allowNewRegistrations: true,
      defaultUserSubscriptionDays: 7,
      enabledFeatures: {
        aiAssistant: true,
        communityFeatures: true,
        tradingAnalytics: true,
        studyGroups: false,
      },
    });

    return settings;
  } catch (error) {
    console.error("[Settings] Error in getSettings:", error);

    // Return default settings object in case of error
    return {
      maintenanceMode: {
        enabled: false,
        message:
          "The site is currently undergoing scheduled maintenance. Please check back shortly.",
      },
      allowNewRegistrations: true,
      defaultUserSubscriptionDays: 7,
      enabledFeatures: {
        aiAssistant: true,
        communityFeatures: true,
        tradingAnalytics: true,
        studyGroups: false,
      },
      lastUpdated: new Date(),
    };
  }
};

// Add a toJSON method to handle non-mongoose instances
SettingsSchema.methods.toJSON = function () {
  const obj = this.toObject ? this.toObject() : this;
  return obj;
};

// Make sure we always have a valid maintenanceMode object
SettingsSchema.pre("save", function (next) {
  if (!this.maintenanceMode) {
    this.maintenanceMode = {
      enabled: false,
      message:
        "The site is currently undergoing scheduled maintenance. Please check back shortly.",
    };
  }
  if (
    this.maintenanceMode &&
    typeof this.maintenanceMode.enabled === "undefined"
  ) {
    this.maintenanceMode.enabled = false;
  }
  if (this.maintenanceMode && !this.maintenanceMode.message) {
    this.maintenanceMode.message =
      "The site is currently undergoing scheduled maintenance. Please check back shortly.";
  }
  next();
});

const Settings = mongoose.model("Settings", SettingsSchema);

module.exports = Settings;
