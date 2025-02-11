const cron = require("node-cron");
const { updateFeaturedReviews } = require("../utils/featuredReviews");

const scheduleFeaturedReviews = () => {
  // '0 6 * * *' means:
  // 0 - At minute 0
  // 6 - At 6 AM
  // * - Every day
  // * - Every month
  // * - Every day of the week
  cron.schedule(
    "0 6 * * *",
    async () => {
      try {
        const updatedReviews = await updateFeaturedReviews();
      } catch (error) {
        console.error("Error in featured reviews scheduled update:", error);
      }
    },
    {
      scheduled: true,
      timezone: "America/New_York", // This ensures it's 6 AM EST
    }
  );
};

module.exports = { scheduleFeaturedReviews };
