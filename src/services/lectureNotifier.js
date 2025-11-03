// controllers/lectureNotifierJob.js
const cron = require("node-cron");
const Lecture = require("../model/lectureModel");
const Class = require("../model/classModel");
const { sendLecturerClassNotification } = require("./whatsapp");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const lectureNotifierJob = cron.schedule(
  "00 19 * * *", // ⏰ 7:30 PM Africa/Lagos
  async () => {
    console.log("📤 Running lecture notification job...");

    try {
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

      const lectures = await Lecture.find({
        startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
      }).populate("class");

      if (!lectures.length) {
        console.log("ℹ️ No lectures scheduled for tomorrow.");
        return;
      }

      for (const lecture of lectures) {
        if (!lecture.class) continue;

        // 🔹 Skip if the class opted out of notifying lecturers
        if (!lecture.class.notifyLecturers) {
          console.log(
            `🚫 Skipping lecturer notification for ${lecture.course} (${lecture.class.title})`
          );
          continue;
        }

        if (!lecture.lecturerWhatsapp) continue;

        try {
          await sendLecturerClassNotification({
            to: lecture.lecturerWhatsapp,
            lecturerName: lecture.lecturer,
            course: lecture.course,
            classId: lecture.class._id.toString(),
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
    timezone: "Africa/Lagos",
  }
);

module.exports = lectureNotifierJob;
