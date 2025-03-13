const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const tradeRoutes = require("./routes/tradeRoutes");
const optionTradeRoutes = require("./routes/optionTradeRoutes");
const tradePlanRoutes = require("./routes/tradePlanRoutes");
const tradeReviewRoutes = require("./routes/tradeReviewRoutes");
const aiRoutes = require("./routes/aiRoutes");
const maintenanceMiddleware = require("./middleware/maintenanceMiddleware");
const featureFlagsMiddleware = require("./middleware/featureFlagsMiddleware");
const { scheduleFeaturedReviews } = require("./schedulers/index");
connectDB();
const studyGroupRoutes = require("./routes/studyGroupRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

// Define allowed origins - add www subdomain
const allowedOrigins = [
  "https://rivyl.app",
  "https://www.rivyl.app",
  "http://localhost:5173",
];

// Add CORS headers directly for early access
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(null, true); // Allow all origins temporarily
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    exposedHeaders: ["Content-Length", "X-Foo", "X-Bar"],
    maxAge: 86400, // 24 hours
  })
);

app.options("*", cors());

// Special handling for Stripe webhook - MUST come before express.json middleware
app.post("/api/auth/webhook", express.raw({ type: "application/json" }));

// Regular parsing middleware for all other routes
app.use((req, res, next) => {
  if (req.originalUrl === "/api/auth/webhook") {
    next();
  } else {
    express.json({ limit: "50mb" })(req, res, next);
  }
});

// Configure passport
require("./config/passport");

// Apply maintenance mode middleware BEFORE routes
// This ensures maintenance mode is checked before any API calls
app.use(maintenanceMiddleware);

// Apply feature flags middleware
app.use(featureFlagsMiddleware);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/option-trades", optionTradeRoutes);
app.use("/api/trade-plans", tradePlanRoutes);
app.use("/api/trade-reviews", tradeReviewRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/study-groups", studyGroupRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use(passport.initialize());

// Initialize schedulers
scheduleFeaturedReviews();

// Base route - improve health check
app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Server Error",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
