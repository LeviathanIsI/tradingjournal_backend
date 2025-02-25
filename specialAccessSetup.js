// specialAccessSetup.js - Run this script with Node.js
const mongoose = require("mongoose");
const User = require("./models/User"); // Path to your User model

// List of user emails to grant special access
const userEmails = [
  "kevinmeier211@gmail.com",
  "jenniecutter27@gmail.com",
  "levitan@mediacombb.net",
  "house007@hotmail.com",
  "n.watkins0427@outlook.com",
  "davetrading69@gmail.com",
  "rivyl.enchanted855@passinbox.com",
  "alicialochary@gmail.com",
];

// Your MongoDB connection string
const connectionString =
  "mongodb+srv://leviathan:Josh1987@cluster0.atr55ns.mongodb.net/tradingJournal?retryWrites=true&w=majority";

// Connect to the database
mongoose
  .connect(connectionString)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("Could not connect to MongoDB", err);
    process.exit(1);
  });

// Function to add special access to users
async function grantSpecialAccess() {
  let updatedCount = 0;
  let notFoundCount = 0;
  let notFoundUsers = [];

  for (const email of userEmails) {
    try {
      // Find user by email and update
      const result = await User.findOneAndUpdate(
        { email },
        {
          specialAccess: {
            hasAccess: true,
            expiresAt: null,
            reason: "Beta Tester",
          },
        },
        { new: true }
      );

      if (result) {
        console.log(`✅ Updated special access for: ${email}`);
        updatedCount++;
      } else {
        console.log(`❌ User not found: ${email}`);
        notFoundCount++;
        notFoundUsers.push(email);
      }
    } catch (error) {
      console.error(`Error updating ${email}:`, error);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total emails processed: ${userEmails.length}`);
  console.log(`Users updated: ${updatedCount}`);
  console.log(`Users not found: ${notFoundCount}`);

  if (notFoundCount > 0) {
    console.log("\nUsers not found:");
    notFoundUsers.forEach((email) => console.log(`- ${email}`));
  }
}

// Run the function and close connection when done
grantSpecialAccess()
  .then(() => {
    console.log("Task completed");
    setTimeout(() => mongoose.connection.close(), 1000);
  })
  .catch((err) => {
    console.error("Error during execution:", err);
    mongoose.connection.close();
  });
