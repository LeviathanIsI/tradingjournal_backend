const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        console.error("❌ User not found in database");
        return res.status(401).json({
          success: false,
          error: "Not authorized, user not found",
        });
      }

      next();
    } catch (error) {
      console.error("❌ Token validation failed:", error.message);
      return res.status(401).json({
        success: false,
        error: "Not authorized, token failed",
      });
    }
  } else {
    console.error("❌ No token found in request headers");
    return res.status(401).json({
      success: false,
      error: "Not authorized, no token",
    });
  }
};

module.exports = { protect };
