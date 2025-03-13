const Settings = require("../models/Settings");
const User = require("../models/User");
const jwt = require("jsonwebtoken");

// Share the cached settings globally so it can be invalidated by settings update
global.cachedSettings = null;
global.lastFetched = 0;

const getCachedSettings = async () => {
  const now = Date.now();
  // Reduce cache to 1 second for quicker updates
  if (global.cachedSettings && now - global.lastFetched < 1000) {
    return global.cachedSettings;
  }
  global.cachedSettings = await Settings.getSettings();
  global.lastFetched = now;
  return global.cachedSettings;
};

// Middleware to check if the site is in maintenance mode
const maintenanceMiddleware = async (req, res, next) => {
  // Extended bypass list for critical routes - EXPANDED to include all admin-related API calls
  const bypassRoutes = [
    // Authentication routes
    "/api/auth/webhook", // Stripe webhooks
    "/api/auth/login", // Login
    "/api/auth/google", // Google auth
    "/api/auth/refresh", // Token refresh
    "/api/auth/verify", // Verification
    "/api/auth/validate", // Token validation
    "/api/auth/public-settings", // Public settings
    "/api/auth/subscription", // Subscription status
    "/api/auth/me/special-access", // Special access check
    "/api/auth/me", // User info

    // Admin routes - all admin paths should bypass
    "/api/admin",

    // Health check
    "/api/health",

    // Password recovery
    "/api/auth/forgot-password",
  ];

  // Check if the route should bypass maintenance mode checks
  // First do an exact match check
  if (bypassRoutes.some((route) => req.path === route)) {
    return next();
  }

  // Then check for path prefix matches
  if (bypassRoutes.some((route) => req.path.startsWith(route))) {
    return next();
  }

  try {
    // Get current settings with minimal caching
    const settings = await getCachedSettings();

    // If maintenance mode is not enabled, continue normally
    if (!settings.maintenanceMode?.enabled) {
      return next();
    }

    // Check if user is an admin (they can bypass maintenance mode)
    let isAdmin = false;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user and check if they're an admin
        const user = await User.findById(decoded.id);
        if (
          user?.specialAccess?.hasAccess &&
          user.specialAccess.reason === "Admin"
        ) {
          isAdmin = true;
          return next();
        }
      } catch (error) {}
    }

    // Return the maintenance message with 503 Service Unavailable status
    return res.status(503).json({
      success: false,
      maintenanceMode: true,
      message: settings.maintenanceMode.message,
    });
  } catch (error) {
    console.error("Error in maintenance middleware:", error);
    // In case of error, don't block the request
    return next();
  }
};

module.exports = maintenanceMiddleware;
