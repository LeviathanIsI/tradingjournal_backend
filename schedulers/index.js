const cron = require("node-cron");
const { updateFeaturedReviews } = require("../utils/featuredReviews");

// Run at 12:01 AM EST every day
const scheduleFeaturedReviews = () => {
  cron.schedule(
    "1 0 * * *",
    async () => {
      console.log("Running featured reviews update...");
      try {
        await updateFeaturedReviews();
        console.log("Featured reviews update completed successfully");
      } catch (error) {
        console.error("Error in featured reviews scheduled update:", error);
      }
    },
    {
      scheduled: true,
      timezone: "America/New_York",
    }
  );
};

module.exports = { scheduleFeaturedReviews };
