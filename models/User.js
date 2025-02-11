const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: 3,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
      minlength: 6,
      select: false,
    },
    googleId: {
      type: String,
      sparse: true,
    },
    securityQuestions: {
      question1: {
        question: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Security question 1 is required for non-Google accounts",
          ],
        },
        answer: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Answer to security question 1 is required for non-Google accounts",
          ],
          select: false,
        },
      },
      question2: {
        question: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Security question 2 is required for non-Google accounts",
          ],
        },
        answer: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Answer to security question 2 is required for non-Google accounts",
          ],
          select: false,
        },
      },
      question3: {
        question: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Security question 3 is required for non-Google accounts",
          ],
        },
        answer: {
          type: String,
          required: [
            function () {
              return !this.googleId;
            },
            "Answer to security question 3 is required for non-Google accounts",
          ],
          select: false,
        },
      },
    },
    preferences: {
      defaultCurrency: {
        type: String,
        default: "USD",
      },
      timeZone: {
        type: String,
        default: "UTC",
      },
      startingCapital: {
        type: Number,
        default: 0,
      },
      experienceLevel: {
        type: String,
        enum: ["auto", "beginner", "intermediate", "advanced"],
        default: "auto",
      },
      darkMode: {
        type: Boolean,
        default: false,
      },
    },
    created: {
      type: Date,
      default: Date.now,
    },
    followers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    following: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    bio: {
      type: String,
      maxLength: 500,
    },
    tradingStyle: {
      type: String,
      enum: ["Day Trader", "Swing Trader", "Position Trader", "Scalper"],
    },
    tourStatus: {
      dashboardTourCompleted: { type: Boolean, default: false },
      communityTourCompleted: { type: Boolean, default: false },
      tradePlanningTourCompleted: { type: Boolean, default: false },
      communityNavTourCompleted: { type: Boolean, default: false },
      reviewsTourCompleted: { type: Boolean, default: false },
      tradersTourCompleted: { type: Boolean, default: false },
      leaderboardTourCompleted: { type: Boolean, default: false },
      featuredTourCompleted: { type: Boolean, default: false },
      profileTourCompleted: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.pre("save", async function (next) {
  // Only hash answers if they've been modified
  if (
    !this.isModified("securityQuestions.question1.answer") &&
    !this.isModified("securityQuestions.question2.answer") &&
    !this.isModified("securityQuestions.question3.answer")
  ) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);

  // Hash each answer if it's been modified
  if (this.isModified("securityQuestions.question1.answer")) {
    this.securityQuestions.question1.answer = await bcrypt.hash(
      this.securityQuestions.question1.answer.toLowerCase().trim(),
      salt
    );
  }
  if (this.isModified("securityQuestions.question2.answer")) {
    this.securityQuestions.question2.answer = await bcrypt.hash(
      this.securityQuestions.question2.answer.toLowerCase().trim(),
      salt
    );
  }
  if (this.isModified("securityQuestions.question3.answer")) {
    this.securityQuestions.question3.answer = await bcrypt.hash(
      this.securityQuestions.question3.answer.toLowerCase().trim(),
      salt
    );
  }

  next();
});

// Add method to verify security answers
userSchema.methods.verifySecurityAnswer = async function (
  questionKey,
  providedAnswer
) {
  try {
    const storedAnswer = this.securityQuestions[questionKey].answer;
    return await bcrypt.compare(
      providedAnswer.toLowerCase().trim(),
      storedAnswer
    );
  } catch (error) {
    console.error("Answer verification error:", error); // Add this for debugging
    return false;
  }
};

// Method to compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;
