const Settings = require("../models/Settings");
const User = require("../models/User");
const jwt = require("jsonwebtoken");

// Feature flag route mapping
const featureRouteMap = {
  aiAssistant: ["/api/ai"],
  communityFeatures: ["/api/trades/community", "/api/community"],
  tradingAnalytics: ["/api/trades/analytics", "/api/trades/stats"],
  studyGroups: ["/api/study-groups"],
};

// Middleware to check if features are enabled
const featureFlagsMiddleware = async (req, res, next) => {
  try {
    // Skip feature check for admin routes
    if (req.path.startsWith("/api/admin")) {
      return next();
    }

    // Get current settings
    const settings = await Settings.getSettings();

    // Check if the requested path falls under any feature flag
    const currentPath = req.path;
    let featureToCheck = null;

    // Find which feature this path belongs to
    for (const [feature, paths] of Object.entries(featureRouteMap)) {
      if (paths.some((path) => currentPath.startsWith(path))) {
        featureToCheck = feature;
        break;
      }
    }

    // If path doesn't match any feature or the feature is enabled, continue
    if (!featureToCheck || settings.enabledFeatures[featureToCheck]) {
      return next();
    }

    // Check if user is an admin (they can bypass feature flags)
    let isAdmin = false;

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user and check if they're an admin
        const user = await User.findById(decoded.id);
        if (
          user &&
          user.specialAccess &&
          user.specialAccess.hasAccess &&
          user.specialAccess.reason === "Admin"
        ) {
          isAdmin = true;
        }
      } catch (error) {
        // Token verification failed, not an admin
      }
    }

    // If user is an admin, bypass feature check
    if (isAdmin) {
      return next();
    }

    // Feature is disabled, return error
    return res.status(403).json({
      success: false,
      featureDisabled: true,
      message: `This feature is currently disabled by the administrator.`,
    });
  } catch (error) {
    console.error("Error in feature flags middleware:", error);
    return next(); // On error, allow the request to pass through
  }
};

module.exports = featureFlagsMiddleware;
