// backend/server.js
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const tradeRoutes = require("./routes/tradeRoutes");
const tradePlanRoutes = require("./routes/tradePlanRoutes");
const tradeReviewRoutes = require("./routes/tradeReviewRoutes");
const insiderTradeRoutes = require("./routes/insiderTradeRoutes");

dotenv.config();
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/trade-plans", tradePlanRoutes);
app.use("/api/trade-reviews", tradeReviewRoutes);
app.use("/api/insider-trades", insiderTradeRoutes);

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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
