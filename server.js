// server.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const app = require("./app");

// Import the lecture notification job
const lectureNotifierJob = require("./src/services/lectureNotifier"); // adjust path if needed
const studentDailySummaryJob = require("./src/services/studentDailySummary");

// Connect to MongoDB
const DB = process?.env?.DATABASE?.replace(
  "<password>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
  })
  .then(() => console.log("✅ Database connection successful"))
  .catch((err) => {
    console.error("❌ Database connection error:", err);
    process.exit(1);
  });

// Start Express server
const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);

  // Start the lecture notification scheduler
  lectureNotifierJob.start();
  console.log("🕗 Lecture notification scheduler started");
  studentDailySummaryJob.start();
  console.log("🕗 student daily scheduler started");
});
