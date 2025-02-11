const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const tradeRoutes = require("./routes/tradeRoutes");
const tradePlanRoutes = require("./routes/tradePlanRoutes");
const tradeReviewRoutes = require("./routes/tradeReviewRoutes");
const { scheduleFeaturedReviews } = require("./schedulers/index");

dotenv.config();
connectDB();

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5000"],
    credentials: true, // Allow cookies and headers
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Configure passport
require("./config/passport");

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/trades", tradeRoutes);
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
