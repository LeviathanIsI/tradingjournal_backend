const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const axios = require("axios");
const { protect } = require("../middleware/authMiddleware");
const Trade = require("../models/Trade");
const OptionTrade = require("../models/OptionTrade");
const User = require("../models/User");

const getEstimatedResponseTime = (tradeType, holdingTimeMs) => {
  let estimatedTime = 30;

  if (tradeType === "option") {
    estimatedTime += 5;
  }

  const holdingTimeHours = holdingTimeMs / (1000 * 60 * 60);
  if (holdingTimeHours > 24) {
    estimatedTime += 10;
  } else if (holdingTimeHours > 4) {
    estimatedTime += 5;
  }

  return estimatedTime;
};

// Helper function to handle AI request limits
const checkAndDecrementAICredits = async (req, res, next) => {
  try {
    // Get full user object with aiRequestLimits
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Check and decrement AI request limit
    const limitResult = await user.useAIRequest();

    if (!limitResult.success) {
      return res.status(403).json({
        success: false,
        error: "Weekly AI request limit reached",
        aiLimits: {
          remainingRequests: 0,
          nextResetDate: user.aiRequestLimits.nextResetDate,
          weeklyLimit: user.aiRequestLimits.weeklyLimit,
        },
      });
    }

    // Add limit info to the request object for use in route handlers
    req.aiLimits = {
      remainingRequests: limitResult.remainingRequests,
      nextResetDate: limitResult.nextResetDate,
      weeklyLimit: user.aiRequestLimits.weeklyLimit,
    };

    next();
  } catch (error) {
    console.error("Error checking AI credits:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check AI request limit",
    });
  }
};

// AI-Powered Weekly Analysis Route
router.post(
  "/analyze-week",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { week } = req.body;

      if (!week) {
        return res.status(400).json({
          success: false,
          error: "Week parameter is required",
        });
      }

      // Parse the week string (format: YYYY-W##)
      const [year, weekNum] = week.split("-W");

      // Calculate start and end dates for the selected week
      const startDate = getDateOfISOWeek(parseInt(weekNum), parseInt(year));
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6); // 6 days after start = end of week

      // Find all trades from both collections that fall within the selected week
      const stockTrades = await Trade.find({
        user: req.user._id,
        entryDate: { $gte: startDate, $lte: endDate },
      });

      const optionTrades = await OptionTrade.find({
        user: req.user._id,
        entryDate: { $gte: startDate, $lte: endDate },
      });

      // If there are no trades for this week, return early
      if (stockTrades.length === 0 && optionTrades.length === 0) {
        return res.json({
          success: true,
          analysis: "No trades found for the selected week.",
        });
      }

      // Prepare a summary of the week's trades
      const totalTrades = stockTrades.length + optionTrades.length;
      let winningTrades = 0;
      let losingTrades = 0;
      let totalProfit = 0;

      // Count stock trade results
      stockTrades.forEach((trade) => {
        if (trade.profitLoss && trade.profitLoss.realized > 0) {
          winningTrades++;
          totalProfit += trade.profitLoss.realized;
        } else if (trade.profitLoss && trade.profitLoss.realized < 0) {
          losingTrades++;
          totalProfit += trade.profitLoss.realized;
        }
      });

      // Count option trade results
      optionTrades.forEach((trade) => {
        if (trade.profitLoss && trade.profitLoss.realized > 0) {
          winningTrades++;
          totalProfit += trade.profitLoss.realized;
        } else if (trade.profitLoss && trade.profitLoss.realized < 0) {
          losingTrades++;
          totalProfit += trade.profitLoss.realized;
        }
      });

      const winRate =
        totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0;

      // Build a prompt for OpenAI
      const tradeSummaries = [...stockTrades, ...optionTrades]
        .map((trade) => {
          return `
        Trade: ${trade.symbol} (${trade.type})
        Entry: ${trade.entryPrice} on ${new Date(
            trade.entryDate
          ).toLocaleDateString()}
        ${
          trade.exitPrice
            ? `Exit: ${trade.exitPrice} on ${new Date(
                trade.exitDate
              ).toLocaleDateString()}`
            : "Still Open"
        }
        ${
          trade.profitLoss
            ? `P/L: $${trade.profitLoss.realized.toFixed(
                2
              )} (${trade.profitLoss.percentage.toFixed(2)}%)`
            : ""
        }
        ${trade.setup ? `Setup: ${trade.setup}` : ""}
        ${trade.notes ? `Notes: ${trade.notes}` : ""}
      `;
        })
        .join("\n\n");

      const username = req.user.username || "Trader";

      const prompt = `
  Analyze ${username}'s performance for the week of ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}:
  
  Weekly Summary:
  - Total Trades: ${totalTrades}
  - Winning Trades: ${winningTrades}
  - Losing Trades: ${losingTrades}
  - Win Rate: ${winRate}%
  - Total P/L: $${totalProfit.toFixed(2)}
  
  Individual Trades:
  ${tradeSummaries}
  
  Please provide a detailed analysis with the following sections clearly labeled:
  
  1. **Overall Analysis**: Summarize the trader's overall performance
  
  2. **Patterns in Winning and Losing Trades**: Identify patterns
     - **Winning Trades**: What worked well
     - **Losing Trades**: What didn't work well
  
  3. **Suggestions and Recommendations**: Provide specific advice
     - **Risk Management**: Suggestions for better risk management
     - **Trade Analysis**: Ways to improve trade selection
     - **Diversification**: Portfolio diversity recommendations
  
  4. **What They Did Well**: Highlight positive aspects of their trading
  
  Format the response with clear section headers, bullet points for details, and use markdown formatting. Address ${username} directly in your analysis.
`;

      // Send request to OpenAI API
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      res.json({
        success: true,
        analysis: response.data.choices[0].message.content,
        estimatedSeconds: 25,
        aiLimits: req.aiLimits,
      });
    } catch (error) {
      console.error("AI Weekly Analysis Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to analyze weekly trades.",
      });
    }
  }
);

// Helper function to get the date of a specific week
function getDateOfISOWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

// New endpoint for Smart Trade Coaching
router.post(
  "/analyze-trade/:tradeId",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { tradeId } = req.params;
      const { type } = req.body; // 'stock' or 'option'

      if (!tradeId) {
        return res.status(400).json({
          success: false,
          error: "Trade ID is required",
        });
      }

      // Find the trade based on type
      const TradeModel = type === "option" ? OptionTrade : Trade;
      const trade = await TradeModel.findOne({
        _id: tradeId,
        user: req.user._id,
      });

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: "Trade not found",
        });
      }

      // Format the entry and exit dates
      const entryDate = new Date(trade.entryDate).toLocaleString();
      const exitDate = trade.exitDate
        ? new Date(trade.exitDate).toLocaleString()
        : "Still Open";

      const username = req.user.username || "Trader";

      // Structure the prompt for OpenAI
      const prompt = `
    Analyze ${username}'s individual trade in detail:
    
    Trade Details:
    - Symbol: ${trade.symbol || trade.ticker}
    - Type: ${trade.type} (${
        type === "option" ? trade.contractType || "Option" : "Stock"
      })
    - Entry Price: $${trade.entryPrice} on ${entryDate}
    - ${
      trade.exitPrice
        ? `Exit Price: $${trade.exitPrice} on ${exitDate}`
        : "Position still open"
    }
    - ${
      trade.profitLoss
        ? `P/L: $${trade.profitLoss.realized.toFixed(2)} (${
            trade.profitLoss.percentage
              ? trade.profitLoss.percentage.toFixed(2)
              : 0
          }%)`
        : ""
    }
    - ${trade.setup ? `Setup/Strategy: ${trade.setup}` : ""}
    - ${trade.stopLoss ? `Stop Loss: $${trade.stopLoss}` : ""}
    - ${trade.target ? `Target: $${trade.target}` : ""}
    - ${trade.notes ? `Trader's Notes: ${trade.notes}` : ""}
    
    Provide a detailed coaching analysis with the following sections:
    
    ## Entry Analysis
    - Was the entry timing optimal based on the price and setup?
    - Did the trader enter at a good risk-to-reward level?
    - Were there any signs of FOMO or emotional decision-making?
    
    ## Exit Execution
    - Did the trader exit at an appropriate time?
    - Was profit maximized or did they leave money on the table?
    - If the exit was due to a stop loss, was it a good decision?
    
    ## Risk Management
    - Was the position size appropriate?
    - Was the stop loss placement effective?
    - How could risk have been better managed?
    
    ## Trade Plan Adherence
    - Did the trader follow their stated setup/strategy?
    - Were there deviations from the plan that helped or hurt the trade?
    - What specific improvements could make this setup more successful next time?
    
    ## Key Takeaways
    - 3-5 concise, actionable lessons from this trade
    - Specific changes to implement in future similar trades
    
    Format the response using markdown with clear section headers and bullet points for readability. Address ${username} directly in your coaching feedback.
`;

      // Send request to OpenAI API
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      res.json({
        success: true,
        tradeAnalysis: response.data.choices[0].message.content,
        estimatedSeconds: 20,
        aiLimits: req.aiLimits,
      });
    } catch (error) {
      console.error("AI Trade Analysis Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to analyze trade.",
      });
    }
  }
);

// AI-Powered Pattern Analysis Route
router.get("/pattern-analysis", protect, async (req, res) => {
  try {
    // Get all completed trades for the user
    const stockTrades = await Trade.find({
      user: req.user._id,
      status: "CLOSED",
    });

    const optionTrades = await OptionTrade.find({
      user: req.user._id,
      status: "CLOSED",
    });

    const allTrades = [...stockTrades, ...optionTrades];

    // If no trades, return early
    if (allTrades.length === 0) {
      return res.json({
        success: true,
        analysis: "Not enough trading history to identify patterns.",
      });
    }

    // Calculate basic statistics by category
    const tradesBySymbol = {};
    const tradesBySetup = {};
    const tradesByTimeOfDay = {
      morning: { count: 0, wins: 0, profit: 0 },
      midday: { count: 0, wins: 0, profit: 0 },
      afternoon: { count: 0, wins: 0, profit: 0 },
    };
    const tradesByDayOfWeek = {
      0: { count: 0, wins: 0, profit: 0 }, // Sunday
      1: { count: 0, wins: 0, profit: 0 }, // Monday
      2: { count: 0, wins: 0, profit: 0 }, // Tuesday
      3: { count: 0, wins: 0, profit: 0 }, // Wednesday
      4: { count: 0, wins: 0, profit: 0 }, // Thursday
      5: { count: 0, wins: 0, profit: 0 }, // Friday
      6: { count: 0, wins: 0, profit: 0 }, // Saturday
    };
    const tradesByHoldingTime = {
      shortTerm: { count: 0, wins: 0, profit: 0 },
      mediumTerm: { count: 0, wins: 0, profit: 0 },
      longTerm: { count: 0, wins: 0, profit: 0 },
    };

    // Analyze each trade
    allTrades.forEach((trade) => {
      // Only process trades with complete P&L data
      if (!trade.profitLoss || trade.profitLoss.realized === undefined) return;

      const profit = trade.profitLoss.realized;
      const isWin = profit > 0;

      // Analyze by symbol
      const symbol = trade.symbol || trade.ticker;
      if (symbol) {
        if (!tradesBySymbol[symbol]) {
          tradesBySymbol[symbol] = { count: 0, wins: 0, profit: 0 };
        }
        tradesBySymbol[symbol].count++;
        if (isWin) tradesBySymbol[symbol].wins++;
        tradesBySymbol[symbol].profit += profit;
      }

      // Analyze by setup
      const setup = trade.setup || "Unknown";
      if (!tradesBySetup[setup]) {
        tradesBySetup[setup] = { count: 0, wins: 0, profit: 0 };
      }
      tradesBySetup[setup].count++;
      if (isWin) tradesBySetup[setup].wins++;
      tradesBySetup[setup].profit += profit;

      // Analyze by time of day
      if (trade.entryDate) {
        const entryDate = new Date(trade.entryDate);
        const hour = entryDate.getHours();

        if (hour < 12) {
          tradesByTimeOfDay.morning.count++;
          if (isWin) tradesByTimeOfDay.morning.wins++;
          tradesByTimeOfDay.morning.profit += profit;
        } else if (hour < 15) {
          tradesByTimeOfDay.midday.count++;
          if (isWin) tradesByTimeOfDay.midday.wins++;
          tradesByTimeOfDay.midday.profit += profit;
        } else {
          tradesByTimeOfDay.afternoon.count++;
          if (isWin) tradesByTimeOfDay.afternoon.wins++;
          tradesByTimeOfDay.afternoon.profit += profit;
        }

        // Analyze by day of week
        const dayOfWeek = entryDate.getDay();
        tradesByDayOfWeek[dayOfWeek].count++;
        if (isWin) tradesByDayOfWeek[dayOfWeek].wins++;
        tradesByDayOfWeek[dayOfWeek].profit += profit;
      }

      // Analyze by holding time
      if (trade.entryDate && trade.exitDate) {
        const entryTime = new Date(trade.entryDate).getTime();
        const exitTime = new Date(trade.exitDate).getTime();
        const holdingTimeMinutes = (exitTime - entryTime) / (1000 * 60);

        if (holdingTimeMinutes < 30) {
          tradesByHoldingTime.shortTerm.count++;
          if (isWin) tradesByHoldingTime.shortTerm.wins++;
          tradesByHoldingTime.shortTerm.profit += profit;
        } else if (holdingTimeMinutes < 120) {
          tradesByHoldingTime.mediumTerm.count++;
          if (isWin) tradesByHoldingTime.mediumTerm.wins++;
          tradesByHoldingTime.mediumTerm.profit += profit;
        } else {
          tradesByHoldingTime.longTerm.count++;
          if (isWin) tradesByHoldingTime.longTerm.wins++;
          tradesByHoldingTime.longTerm.profit += profit;
        }
      }
    });

    // Format the data for OpenAI

    // Top symbols by win rate (min 3 trades)
    const symbolStats = Object.entries(tradesBySymbol)
      .filter(([_, data]) => data.count >= 3)
      .map(([symbol, data]) => ({
        symbol,
        winRate: ((data.wins / data.count) * 100).toFixed(1),
        profit: data.profit.toFixed(2),
        count: data.count,
      }))
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    // Top setups by win rate (min 2 trades)
    const setupStats = Object.entries(tradesBySetup)
      .filter(([_, data]) => data.count >= 2)
      .map(([setup, data]) => ({
        setup,
        winRate: ((data.wins / data.count) * 100).toFixed(1),
        profit: data.profit.toFixed(2),
        count: data.count,
      }))
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    // Time of day stats
    const timeOfDayStats = Object.entries(tradesByTimeOfDay)
      .map(([timeOfDay, data]) => ({
        timeOfDay,
        winRate:
          data.count > 0 ? ((data.wins / data.count) * 100).toFixed(1) : "0.0",
        profit: data.profit.toFixed(2),
        count: data.count,
      }))
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    // Day of week stats
    const daysOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayOfWeekStats = Object.entries(tradesByDayOfWeek)
      .map(([day, data]) => ({
        day: daysOfWeek[parseInt(day)],
        winRate:
          data.count > 0 ? ((data.wins / data.count) * 100).toFixed(1) : "0.0",
        profit: data.profit.toFixed(2),
        count: data.count,
      }))
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    // Holding time stats
    const holdingTimeStats = Object.entries(tradesByHoldingTime)
      .map(([duration, data]) => {
        let durationLabel = duration;
        if (duration === "shortTerm") durationLabel = "< 30 minutes";
        if (duration === "mediumTerm") durationLabel = "30 - 120 minutes";
        if (duration === "longTerm") durationLabel = "> 120 minutes";

        return {
          duration: durationLabel,
          winRate:
            data.count > 0
              ? ((data.wins / data.count) * 100).toFixed(1)
              : "0.0",
          profit: data.profit.toFixed(2),
          count: data.count,
        };
      })
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    const username = req.user.username || "Trader";

    // Build prompt for OpenAI
    const prompt = `
   Analyze ${username}'s trading patterns based on their trading history:
    
    Total Trades Analyzed: ${allTrades.length}
    
    ## Performance by Symbol
    ${symbolStats
      .map(
        (s) =>
          `- ${s.symbol}: ${s.winRate}% win rate (${s.count} trades), Total P/L: $${s.profit}`
      )
      .join("\n")}
    
    ## Performance by Setup/Strategy
    ${setupStats
      .map(
        (s) =>
          `- ${s.setup}: ${s.winRate}% win rate (${s.count} trades), Total P/L: $${s.profit}`
      )
      .join("\n")}
    
    ## Performance by Time of Day
    ${timeOfDayStats
      .map(
        (t) =>
          `- ${t.timeOfDay}: ${t.winRate}% win rate (${t.count} trades), Total P/L: $${t.profit}`
      )
      .join("\n")}
    
    ## Performance by Day of Week
    ${dayOfWeekStats
      .map(
        (d) =>
          `- ${d.day}: ${d.winRate}% win rate (${d.count} trades), Total P/L: $${d.profit}`
      )
      .join("\n")}
    
    ## Performance by Holding Time
    ${holdingTimeStats
      .map(
        (h) =>
          `- ${h.duration}: ${h.winRate}% win rate (${h.count} trades), Total P/L: $${h.profit}`
      )
      .join("\n")}
    
    Based on this data, provide a detailed analysis with the following sections:
    
    1. **Key Performance Patterns**: Identify 3-5 clear patterns in the trader's performance.
    
    2. **Strengths to Leverage**: Which specific trading conditions consistently produce the best results? Include concrete metrics.
    
    3. **Areas for Improvement**: Which trading conditions consistently underperform? Include specific metrics and actionable advice.
    
    4. **Strategic Recommendations**: Provide 3-5 specific, actionable recommendations to improve overall performance.
    
    Format your response using markdown with clear section headers and bullet points for readability. Address ${username} directly in your analysis and recommendations.
`;

    // Send request to OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      success: true,
      analysis: response.data.choices[0].message.content,
      data: {
        symbolStats,
        setupStats,
        timeOfDayStats,
        dayOfWeekStats,
        holdingTimeStats,
        estimatedSeconds: 25,
        aiLimits: req.aiLimits,
      },
    });
  } catch (error) {
    console.error("AI Pattern Analysis Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to analyze trading patterns.",
    });
  }
});

// Add this route to your file, between the other routes
router.post(
  "/predictive-analysis",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { tradeId, type, scenario } = req.body;

      if (!tradeId || !type || !scenario) {
        return res.status(400).json({
          success: false,
          error: "Trade ID, type, and scenario are required",
        });
      }

      // Get username for personalization
      const username = req.user.username || "Trader";

      // Find the trade based on type
      const TradeModel = type === "option" ? OptionTrade : Trade;
      const trade = await TradeModel.findOne({
        _id: tradeId,
        user: req.user._id,
      });

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: "Trade not found",
        });
      }

      // Get basic trade details
      const symbol = trade.symbol || trade.ticker;
      const entryDate = new Date(trade.entryDate);
      const exitDate = trade.exitDate ? new Date(trade.exitDate) : null;

      // Format dates
      const formattedEntryDate = entryDate.toLocaleString();
      const formattedExitDate = exitDate
        ? exitDate.toLocaleString()
        : "Position still open";

      // Calculate trade metrics
      const actualProfitLoss = trade.profitLoss?.realized || 0;
      const actualPercentage = trade.profitLoss?.percentage || 0;
      const holdingTimeMs = exitDate
        ? exitDate - entryDate
        : new Date() - entryDate;
      const holdingTimeHours = (holdingTimeMs / (1000 * 60 * 60)).toFixed(1);

      // Build scenario description based on scenario type
      let scenarioDescription = "";

      switch (scenario) {
        case "optimal-exit":
          scenarioDescription = `What if ${username} had exited at the optimal price point?`;
          break;
        case "longer-hold":
          scenarioDescription = `What if ${username} had held the position twice as long?`;
          break;
        case "tighter-stop":
          scenarioDescription = `What if ${username} had used a stop loss 50% closer to entry?`;
          break;
        case "wider-stop":
          scenarioDescription = `What if ${username} had used a stop loss 50% further from entry?`;
          break;
        case "different-entry":
          scenarioDescription = `What if ${username} had waited for a better entry point?`;
          break;
        default:
          scenarioDescription = `What if ${username} had used a different strategy?`;
      }

      // Structure the prompt for OpenAI
      const prompt = `
    Analyze this alternative scenario for ${username}'s trade:
    
    Trade Details:
    - Symbol: ${symbol}
    - Type: ${trade.type} ${
        type === "option" ? `(${trade.contractType || "Option"})` : ""
      }
    - Direction: ${trade.type === "LONG" ? "Long" : "Short"}
    - Entry Price: $${trade.entryPrice} on ${formattedEntryDate}
    - ${
      exitDate
        ? `Exit Price: $${trade.exitPrice} on ${formattedExitDate}`
        : "Position still open"
    }
    - Holding Time: ${holdingTimeHours} hours
    - ${
      trade.stopLoss ? `Stop Loss: $${trade.stopLoss}` : "No stop loss recorded"
    }
    - ${trade.target ? `Target: $${trade.target}` : "No target recorded"}
    - Actual P/L: $${actualProfitLoss.toFixed(2)} (${actualPercentage.toFixed(
        2
      )}%)
    - Setup/Strategy: ${trade.setup || "Not specified"}
    - Notes: ${trade.notes || ""}
    
    Scenario to Analyze: ${scenarioDescription}
    
    Please provide a detailed analysis with the following sections:
    
    ## Alternative Outcome
    - Describe what would likely have happened in this scenario
    - Estimate the potential P/L in dollars and percentage
    - Analyze the risk-reward ratio of this alternative approach
    
    ## Market Context
    - Explain relevant market conditions that would affect this scenario
    - Analyze volatility factors that might impact the outcome
    
    ## Probability Assessment
    - Assess the probability of success for this alternative approach
    - Compare the expected value of this approach vs. the actual trade
    
    ## Strategic Insights
    - Provide 3-4 actionable insights based on this analysis
    - Suggest specific criteria for when to use this alternative approach
    - Explain how this could be systematized for future trades
    
    ## Risk Management Implications
    - Analyze how this alternative would affect overall portfolio risk
    - Discuss position sizing considerations for this approach
    
    Format your response using markdown with clear section headers and bullet points for readability. Directly address ${username} in your analysis. Be specific about numbers and probabilities.

    IMPORTANT FORMATTING INSTRUCTIONS:
    1. Do NOT use LaTeX math notation (no \\text{}, \\times, \\frac{}{}, \\approx)
    2. Do NOT use square brackets [ ] around calculations
    3. Write math expressions in plain text: use "×" for multiplication, "÷" for division
    4. For percentages and financial calculations, use simple formats like:
      - "P/L = $1.20 - $0.94 = $0.26 per share"
      - "Return = $25.66/$94.20 = 27.24%"
    5. Use plain dollar signs for currency (e.g., $25.66)
    6. Use standard bullet points with a single asterisk (*)
    `;

      // Send request to OpenAI
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1500,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      res.json({
        success: true,
        analysis: response.data.choices[0].message.content,
        tradeDetails: {
          symbol,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          entryDate: formattedEntryDate,
          exitDate: formattedExitDate,
          profitLoss: actualProfitLoss,
          percentage: actualPercentage,
          holdingTime: holdingTimeHours,
          tradeType: trade.type,
          estimatedSeconds: getEstimatedResponseTime(type, holdingTimeMs),
          aiLimits: req.aiLimits,
        },
      });
    } catch (error) {
      console.error("Predictive Analysis Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to analyze predictive scenario.",
      });
    }
  }
);

// Add a route for estimating the predictive analysis time too (optional)
router.post(
  "/predictive-analysis-estimate",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { tradeId, type } = req.body;

      if (!tradeId || !type) {
        return res.status(400).json({
          success: false,
          error: "Trade ID and type are required",
        });
      }

      // Find the trade to get its details
      const TradeModel = type === "option" ? OptionTrade : Trade;
      const trade = await TradeModel.findOne({
        _id: tradeId,
        user: req.user._id,
      });

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: "Trade not found",
        });
      }

      // Calculate holding time
      const entryDate = new Date(trade.entryDate);
      const exitDate = trade.exitDate ? new Date(trade.exitDate) : new Date();
      const holdingTimeMs = exitDate - entryDate;

      // Get estimated time
      const estimatedSeconds = getEstimatedResponseTime(type, holdingTimeMs);

      return res.json({
        success: true,
        estimatedSeconds,
        aiLimits: req.aiLimits,
      });
    } catch (error) {
      console.error(
        "Error calculating predictive analysis time estimate:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to calculate time estimate",
        estimatedSeconds: 25, // Fallback estimate
      });
    }
  }
);

router.post(
  "/trade-execution-estimate",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { tradeId, type } = req.body;

      if (!tradeId || !type) {
        return res.status(400).json({
          success: false,
          error: "Trade ID and type are required",
        });
      }

      // Find the trade to get its details
      const TradeModel = type === "option" ? OptionTrade : Trade;
      const trade = await TradeModel.findOne({
        _id: tradeId,
        user: req.user._id,
      });

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: "Trade not found",
        });
      }

      // Calculate holding time
      const entryDate = new Date(trade.entryDate);
      const exitDate = trade.exitDate ? new Date(trade.exitDate) : new Date();
      const holdingTimeMs = exitDate - entryDate;

      // Get estimated time
      const estimatedSeconds = getEstimatedResponseTime(type, holdingTimeMs);

      return res.json({
        success: true,
        estimatedSeconds,
        aiLimits: req.aiLimits,
      });
    } catch (error) {
      console.error("Error calculating time estimate:", error);
      res.status(500).json({
        success: false,
        error: "Failed to calculate time estimate",
        estimatedSeconds: 30, // Fallback estimate
      });
    }
  }
);

// Predictive Trade Outcome Analysis Route
router.post(
  "/trade-execution-replay",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { tradeId, type } = req.body;

      if (!tradeId || !type) {
        return res.status(400).json({
          success: false,
          error: "Trade ID and type are required",
        });
      }

      // Get username for personalization
      const username = req.user.username || "Trader";

      // Find the trade based on type - No populate call
      const TradeModel = type === "option" ? OptionTrade : Trade;
      const trade = await TradeModel.findOne({
        _id: tradeId,
        user: req.user._id,
      });

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: "Trade not found",
        });
      }

      // Get market conditions during the trade
      const symbol = trade.symbol || trade.ticker;
      const entryDate = new Date(trade.entryDate);
      const exitDate = trade.exitDate ? new Date(trade.exitDate) : null;

      // Format the entry and exit dates
      const formattedEntryDate = entryDate.toLocaleString();
      const formattedExitDate = exitDate
        ? exitDate.toLocaleString()
        : "Position still open";

      // Calculate actual trade performance
      const actualProfitLoss = trade.profitLoss?.realized || 0;
      const actualPercentage = trade.profitLoss?.percentage || 0;
      const holdingTimeMs = exitDate
        ? exitDate - entryDate
        : new Date() - entryDate;
      const holdingTimeHours = (holdingTimeMs / (1000 * 60 * 60)).toFixed(1);

      // Get trade details from the trade model directly
      const tradeNotes = trade.notes || "";
      const setup = trade.setup || trade.pattern || trade.strategy || "";
      const mistakes = Array.isArray(trade.mistakes)
        ? trade.mistakes.join(", ")
        : "";

      // Try to find associated trade review for additional insights
      let tradeReview = null;
      try {
        // Only attempt if TradeReview model is defined
        if (mongoose.models.TradeReview) {
          tradeReview = await mongoose.models.TradeReview.findOne({
            trade: tradeId,
            user: req.user._id,
          });
        }
      } catch (err) {
        console.error("Error finding trade review:", err);
      }

      // Structure the prompt for OpenAI
      const prompt = `
    Perform a detailed trade execution replay analysis for this trade:
    
    Trade Details:
    - Trader: ${username}
    - Symbol: ${symbol}
    - Type: ${trade.type} ${
        type === "option" ? `(${trade.contractType || "Option"})` : ""
      }
    - Direction: ${trade.type === "LONG" ? "Long" : "Short"}
    - Entry Price: $${trade.entryPrice} on ${formattedEntryDate}
    - ${
      exitDate
        ? `Exit Price: $${trade.exitPrice} on ${formattedExitDate}`
        : "Position still open"
    }
    - Holding Time: ${holdingTimeHours} hours
    - ${
      trade.stopLoss ? `Stop Loss: $${trade.stopLoss}` : "No stop loss recorded"
    }
    - ${trade.target ? `Target: $${trade.target}` : "No target recorded"}
    - Actual P/L: $${actualProfitLoss.toFixed(2)} (${actualPercentage.toFixed(
        2
      )}%)
    - Setup/Strategy: ${setup}
    - Trader's Notes: ${tradeNotes}
    ${mistakes ? `- Mistakes Identified: ${mistakes}` : ""}
    ${
      tradeReview?.whatWentWell
        ? `- What Went Well: ${tradeReview.whatWentWell}`
        : ""
    }
    ${
      tradeReview?.whatWentWrong
        ? `- What Went Wrong: ${tradeReview.whatWentWrong}`
        : ""
    }
    ${
      tradeReview?.lessonLearned
        ? `- Lesson Learned: ${tradeReview.lessonLearned}`
        : ""
    }
    
    Your task is to reconstruct the trader's execution step-by-step, similar to how a sports coach breaks down game film. Analyze:

    1. **Entry Timing** - Did they enter at a good price point? Did they hesitate? Rush in?
    2. **Exit Execution** - Was their exit well-timed? Did they leave money on the table?
    3. **Decision Points** - What key moments occurred during the trade where decisions were made?
    4. **Missed Opportunities** - Identify any better entry or exit points they could have taken
    5. **Hesitations** - Note any evidence of hesitation or uncertainty in their execution
    
    Please provide your response in a JSON format with two main properties:
    1. "analysis": A detailed markdown analysis with clear section headers.
    2. "timeline": An array of events during the trade, where each event has:
       - "timestamp": Approximate timestamp (e.g., "2023-01-15T09:32:00")
       - "title": Brief title of the event
       - "description": Detailed description
       - "actionType": One of "entry", "exit", "hover", "hesitation", "opportunity", or "market"
       - "insight": (Optional) Coaching insight about this moment
    
    For the timeline, create a detailed time-based reconstruction with 5-8 key events like:
    - Pre-trade preparation
    - Entry decision process
    - Key price movements during the hold
    - Exit decision process
    - Post-trade reflection

    Use realistic timestamps between entry time (${formattedEntryDate}) and exit time (${
        formattedExitDate || "now"
      }).
    
    Address ${username} directly in a conversational but professional coaching tone. Offer specific actionable advice.
    `;

      try {
        // Send request to OpenAI API with better error handling
        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content:
                  "You are an expert trading coach analyzing trade execution. You reconstruct trades step-by-step like a sports coach breaking down game film. Your focus is on precise timing, decision points, hesitations, and missed opportunities. Your analysis is specific, actionable, and educational.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            max_tokens: 2000,
            response_format: { type: "json_object" },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        // Check if we got a valid response with choices
        if (
          !response.data ||
          !response.data.choices ||
          !response.data.choices[0].message
        ) {
          throw new Error("Invalid response from OpenAI API");
        }

        const aiResponseText = response.data.choices[0].message.content;

        // Safely parse the JSON response
        let aiResponse;
        try {
          aiResponse = JSON.parse(aiResponseText);
        } catch (parseError) {
          console.error("Error parsing OpenAI JSON response:", parseError);
          // Attempt to create a valid response from invalid JSON
          aiResponse = {
            analysis:
              "Error parsing AI response. Here's what we received: " +
              aiResponseText.substring(0, 200) +
              "...",
            timeline: [],
          };
        }

        // Make sure we have the expected structure with fallbacks
        const analysis = aiResponse.analysis || "No analysis provided";
        const timeline = Array.isArray(aiResponse.timeline)
          ? aiResponse.timeline
          : [];

        // Ensure each timeline item has all required properties
        const formattedTimeline = timeline.map((item) => ({
          timestamp: item.timestamp || new Date().toISOString(),
          title: item.title || "Event",
          description: item.description || "",
          actionType: item.actionType || "market",
          insight: item.insight || "",
        }));

        res.json({
          success: true,
          analysis: analysis,
          timeline: formattedTimeline,
          tradeDetails: {
            symbol,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            entryDate: formattedEntryDate,
            exitDate: formattedExitDate,
            profitLoss: actualProfitLoss,
            percentage: actualPercentage,
            holdingTime: holdingTimeHours,
            tradeType: trade.type,
            estimatedSeconds: getEstimatedResponseTime(type, holdingTimeMs),
            aiLimits: req.aiLimits,
          },
        });
      } catch (openAiError) {
        console.error("OpenAI API Error:", openAiError);

        // More specific error message based on the error type
        let errorMessage = "Failed to analyze trade execution.";

        if (openAiError.response && openAiError.response.data) {
          console.error(
            "OpenAI API Error details:",
            JSON.stringify(openAiError.response.data)
          );
          if (openAiError.response.data.error) {
            errorMessage = `OpenAI API error: ${
              openAiError.response.data.error.message ||
              openAiError.response.data.error
            }`;
          }
        }

        res.status(500).json({
          success: false,
          error: errorMessage,
        });
      }
    } catch (error) {
      console.error("AI Trade Execution Replay Error:", error);
      res.status(500).json({
        success: false,
        error:
          "Failed to analyze trade execution. Server error: " +
          (error.message || "Unknown error"),
      });
    }
  }
);

// AI-Driven Trading Bot Simulator Route
router.post(
  "/trading-bot-simulator",
  protect,
  checkAndDecrementAICredits,
  async (req, res) => {
    try {
      const { symbol, timeframe, strategy } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: "Symbol parameter is required",
        });
      }

      // Get user's past trades for this symbol to analyze patterns
      const stockTrades = await Trade.find({
        user: req.user._id,
        symbol: symbol,
        status: "CLOSED",
      });

      const optionTrades = await OptionTrade.find({
        user: req.user._id,
        ticker: symbol,
        status: "CLOSED",
      });

      const allTrades = [...stockTrades, ...optionTrades];

      // If there are no trades for this symbol, return early
      if (allTrades.length === 0) {
        return res.json({
          success: true,
          message:
            "No historical trades found for this symbol. AI needs your past trades to generate accurate simulations.",
          aiLimits: req.aiLimits,
        });
      }

      // Analyze user's trading patterns
      const winningTrades = allTrades.filter(
        (trade) => trade.profitLoss?.realized > 0
      );
      const losingTrades = allTrades.filter(
        (trade) => trade.profitLoss?.realized < 0
      );

      const winRate =
        allTrades.length > 0
          ? ((winningTrades.length / allTrades.length) * 100).toFixed(2)
          : 0;

      const avgWinAmount =
        winningTrades.length > 0
          ? (
              winningTrades.reduce(
                (sum, trade) => sum + trade.profitLoss.realized,
                0
              ) / winningTrades.length
            ).toFixed(2)
          : 0;

      const avgLossAmount =
        losingTrades.length > 0
          ? (
              losingTrades.reduce(
                (sum, trade) => sum + trade.profitLoss.realized,
                0
              ) / losingTrades.length
            ).toFixed(2)
          : 0;

      // Get user trading style from their profile
      const tradingStyle = req.user.tradingStyle || "Day Trader";

      // Build a prompt for OpenAI
      const prompt = `
You are an AI Trading Bot Simulator for a trader with the following characteristics:

Trading Profile:
- Trading Style: ${tradingStyle}
- Win Rate on ${symbol}: ${winRate}%
- Average Win Amount: $${avgWinAmount}
- Average Loss Amount: $${avgLossAmount}
- Timeframe Preference: ${timeframe || "Intraday"}
- Preferred Strategy: ${strategy || "Based on past trades"}

Past Trades on ${symbol}:
${allTrades
  .map((trade) => {
    return `
  Trade Date: ${new Date(trade.entryDate).toLocaleDateString()}
  Entry: $${trade.entryPrice}
  Exit: ${trade.exitPrice ? `$${trade.exitPrice}` : "Still Open"}
  P/L: $${trade.profitLoss?.realized.toFixed(2) || "N/A"}
  Setup: ${trade.setup || "Not specified"}
  Notes: ${trade.notes || "None"}
  `;
  })
  .join("\n")}

Based on this trader's past performance and trading patterns on ${symbol}, please provide:

1. **Optimal Entry Strategy**: Analyze their trading patterns and recommend the best entry strategy for this symbol.

2. **Entry Points Simulation**: Suggest 3 potential entry points with rationales, based on the trader's successful patterns.

3. **Position Sizing Recommendation**: Calculate optimal position size based on their risk tolerance shown in past trades.

4. **Stop Loss Strategy**: Based on their past trading, what stop loss approach would optimize their results? 

5. **Exit Strategy Optimization**: Analyze their exits and recommend improvements for maximizing profits.

6. **What-If Scenarios**: Show 3 different scenarios with different R:R (risk-reward) ratios and how they would likely perform based on historical data.

Format your response as JSON with the following structure:
{
  "optimalEntryStrategy": "detailed explanation here",
  "entryPoints": [
    {"price": 123.45, "rationale": "explanation here"}, 
    {"price": 124.50, "rationale": "explanation here"},
    {"price": 122.75, "rationale": "explanation here"}
  ],
  "positionSizing": {"recommendation": "explanation here", "rationale": "explanation here"},
  "stopLossStrategy": {"recommendation": "explanation here", "rationale": "explanation here"},
  "exitStrategyOptimization": {"recommendation": "explanation here", "rationale": "explanation here"},
  "scenarios": [
    {"description": "Conservative", "riskRewardRatio": "1:2", "expectedOutcome": "explanation here"},
    {"description": "Moderate", "riskRewardRatio": "1:3", "expectedOutcome": "explanation here"},
    {"description": "Aggressive", "riskRewardRatio": "1:4", "expectedOutcome": "explanation here"}
  ]
}
`;

      // Send request to OpenAI API
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1500,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Parse the JSON response
      let simulationData;
      try {
        simulationData = JSON.parse(response.data.choices[0].message.content);

        if (
          !simulationData.optimalEntryStrategy ||
          !simulationData.entryPoints ||
          !simulationData.positionSizing ||
          !simulationData.stopLossStrategy ||
          !simulationData.exitStrategyOptimization ||
          !simulationData.scenarios
        ) {
          console.warn(
            "Incomplete simulation data from OpenAI:",
            simulationData
          );
        }
      } catch (error) {
        console.error("Failed to parse OpenAI response as JSON:", error);
        simulationData = { error: "Failed to parse AI response" };
      }

      res.json({
        success: true,
        simulation: simulationData,
        tradeHistory: {
          totalTrades: allTrades.length,
          winRate: winRate,
          avgWin: avgWinAmount,
          avgLoss: avgLossAmount,
        },
        aiLimits: req.aiLimits,
        estimatedSeconds: 30,
      });
    } catch (error) {
      console.error("AI Trading Bot Simulator Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate trading simulation.",
      });
    }
  }
);

module.exports = router;
