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
const { scheduleFeaturedReviews } = require("./schedulers/index");

console.log("Environment Variables:", {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? "Exists" : "Not found",
  NODE_ENV: process.env.NODE_ENV,
});
connectDB();

const app = express();

const allowedOrigins = ["https://rivyl.app", "http://localhost:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation: " + origin));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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
    express.json()(req, res, next);
  }
});

// Configure passport
require("./config/passport");

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/option-trades", optionTradeRoutes);
app.use("/api/trade-plans", tradePlanRoutes);
app.use("/api/trade-reviews", tradeReviewRoutes);
app.use(passport.initialize());

// Initialize schedulers
scheduleFeaturedReviews();

// Base route
app.get("/", (req, res) => res.send("API is running..."));

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
  console.log("Schedulers initialized...");
});
