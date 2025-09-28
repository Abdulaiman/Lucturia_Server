const cron = require("node-cron");
const Lecture = require("../model/lectureModel");
const { sendLecturerClassNotification } = require("./whatsapp"); // adapt to your WhatsApp.js
const dayjs = require("dayjs"); // optional, for date manipulation

// Schedule daily at 8 PM
const lectureNotifierJob = cron.schedule(
  "39 14 * * *",
  async () => {
    try {
      console.log("📤 Running lecture notification job...");

      // Tomorrow's date range
      const tomorrowStart = dayjs().add(1, "day").startOf("day").toDate();
      const tomorrowEnd = dayjs().add(1, "day").endOf("day").toDate();

      // Fetch all lectures for tomorrow
      const lectures = await Lecture.find({
        startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
      });
      for (const lecture of lectures) {
        if (!lecture.lecturerWhatsapp) continue;

        try {
          await sendLecturerClassNotification({
            to: lecture.lecturerWhatsapp,
            lecturerName: lecture.lecturer,
            course: lecture.course,
            classId: lecture.class.toString(), // or populate if needed
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
    scheduled: false, // start manually
  }
);

module.exports = lectureNotifierJob;
