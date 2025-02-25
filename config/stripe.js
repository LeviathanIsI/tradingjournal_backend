const stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is not defined in environment variables");
  process.exit(1);
}

const stripeClient = stripe(process.env.STRIPE_SECRET_KEY.trim(), {
  apiVersion: "2023-10-16",
});

module.exports = stripeClient;
