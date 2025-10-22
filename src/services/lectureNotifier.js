const cron = require("node-cron");
const Lecture = require("../model/lectureModel");
const { sendLecturerClassNotification } = require("./whatsapp");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

// Schedule daily at 7:30 PM Lagos time
const lectureNotifierJob = cron.schedule(
  "56 20 * * *", // 19:30 = 7:30 PM
  async () => {
    console.log("📤 Running lecture notification job...");

    try {
      // 🔹 Compute tomorrow in Africa/Lagos
      const tomorrowStart = dayjs()
        .tz("Africa/Lagos")
        .add(1, "day")
        .startOf("day")
        .toDate();
      const tomorrowEnd = dayjs()
        .tz("Africa/Lagos")
        .add(1, "day")
        .endOf("day")
        .toDate();

      // Fetch all lectures for tomorrow (stored in UTC, but boundaries calculated in Lagos)
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
            // Format times in Africa/Lagos
            startTime: dayjs(lecture.startTime)
              .tz("Africa/Lagos")
              .format("HH:mm"),
            endTime: dayjs(lecture.endTime).tz("Africa/Lagos").format("HH:mm"),
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
    scheduled: true,
    timezone: "Africa/Lagos", // cron itself runs in Lagos timezone
  }
);

module.exports = lectureNotifierJob;
