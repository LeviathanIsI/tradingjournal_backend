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
      callbackURL: "https://rivyl.app/auth/google/callback",
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("🔄 Google OAuth Strategy Triggered");
        console.log("📌 Google Profile:", profile);

        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          console.log("🆕 Creating New User...");
          user = await User.create({
            username: profile.displayName,
            email: profile.emails[0].value,
            googleId: profile.id,
            googleAuth: true,
          });
        } else {
          console.log("✅ Existing User Found, Updating GoogleAuth Status...");
          user.googleAuth = true;
          await user.save();
        }

        console.log("🔑 Successfully Authenticated:", user);
        return done(null, user);
      } catch (error) {
        console.error("❌ Error in Google OAuth Strategy:", error);
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

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
