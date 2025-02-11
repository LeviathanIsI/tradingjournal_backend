const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  process.exit(1);
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/auth/google/callback`
        : "http://localhost:5173/auth/google/callback",
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("✅ Google OAuth Callback Triggered");
        console.log("🔹 Access Token:", accessToken);
        console.log("🔹 Refresh Token:", refreshToken);
        console.log("🔹 Profile:", profile);

        let user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          console.log("✅ User Found:", user);
          if (!user.googleId) {
            console.log("🔹 Updating user to store Google ID");
            user.googleId = profile.id;
            await user.save();
          }
          return done(null, user);
        } else {
          console.log("🔹 Creating new user");
          user = await User.create({
            username: profile.displayName,
            email: profile.emails[0].value,
            googleId: profile.id,
          });
          return done(null, user);
        }
      } catch (error) {
        console.error("❌ Error in Google strategy:", error);
        return done(error, null);
      }
    }
  )
);

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    console.error("Deserialize error:", error);
    done(error, null);
  }
});

module.exports = passport;
