// middleware/adminMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Middleware to protect routes that should only be accessible by admin users
 * This checks the user's special access privileges set in their account
 */
const adminProtect = async (req, res, next) => {
  let token;

  // Check if token exists in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from the token
      const user = await User.findById(decoded.id).select("-password");

      if (!user) {
        return res.status(401).json({
          success: false,
          error: "Not authorized, no user found",
        });
      }

      // Check if user has admin special access
      if (
        !user.specialAccess ||
        !user.specialAccess.hasAccess ||
        user.specialAccess.reason !== "Admin"
      ) {
        return res.status(403).json({
          success: false,
          error: "Admin access required",
        });
      }

      // Set user in request object
      req.user = user;
      next();
    } catch (error) {
      console.error("Admin middleware error:", error);

      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          error: "Not authorized, invalid token",
        });
      }

      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error: "Not authorized, token expired",
        });
      }

      res.status(401).json({
        success: false,
        error: "Not authorized",
      });
    }
  } else {
    res.status(401).json({
      success: false,
      error: "Not authorized, no token",
    });
  }
};

module.exports = { adminProtect };
