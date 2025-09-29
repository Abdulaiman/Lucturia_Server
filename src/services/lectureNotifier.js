const cron = require("node-cron");
const Lecture = require("../model/lectureModel");
const { sendLecturerClassNotification } = require("./whatsapp"); // adapt to your WhatsApp.js
const dayjs = require("dayjs"); // optional, for date manipulation

// Schedule daily at 8 PM
const lectureNotifierJob = cron.schedule(
  "24 15 * * *", // 7:30 PM daily
  async () => {
    console.log("📤 Running lecture notification job...");

    try {
      // Get tomorrow's start and end
      const tomorrowStart = dayjs().add(1, "day").startOf("day").toDate();
      const tomorrowEnd = dayjs().add(1, "day").endOf("day").toDate();

      // Fetch all lectures for tomorrow
      const lectures = await Lecture.find({
        startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
      });

      if (!lectures.length) {
        console.log("ℹ️ No lectures scheduled for tomorrow.");
        return;
      }

      // Send notifications
      for (const lecture of lectures) {
        if (!lecture.lecturerWhatsapp) continue;

        try {
          await sendLecturerClassNotification({
            to: lecture.lecturerWhatsapp,
            lecturerName: lecture.lecturer,
            course: lecture.course,
            classId: lecture.class.toString(),
            startTime: lecture.startTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            endTime: lecture.endTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            location: lecture.location || "TBA",
            lectureId: lecture.id,
          });

          console.log(`✅ Notified ${lecture.lecturer}`);
        } catch (err) {
          console.error(
            `⚠️ Failed to notify ${lecture.lecturer}:`,
            err.message
          );
        }
      }
    } catch (err) {
      console.error("❌ Lecture notification job failed:", err.message);
    }
  },
  {
    scheduled: true, // starts automatically
    timezone: "Africa/Lagos", // explicit timezone
  }
);

module.exports = lectureNotifierJob;
