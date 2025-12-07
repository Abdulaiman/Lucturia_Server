// controllers/studentEveningReminderJob.js
const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const {
  sendWhatsAppText,
  sendScheduleReadyTemplate,
  hasActiveSession,
} = require("./whatsapp");

dayjs.extend(utc);
dayjs.extend(timezone);

function formatLagosDate(date) {
  return dayjs(date).tz("Africa/Lagos").format("dddd, MMM D YYYY");
}

function getFirstName(fullName) {
  if (!fullName) return "";
  const first = fullName.trim().split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const studentEveningReminderJob = cron.schedule(
  "23 17 * * *", // 6 PM
  async () => {
    console.log("📤 Running student evening (tomorrow) reminder job...");

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

    try {
      const students = await User.find().populate("class");

      for (const student of students) {
        if (!student.whatsappNumber || !student.class) continue;

        const lectures = await Lecture.find({
          class: student.class._id,
          startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
        });

        if (!lectures.length) continue;

        const firstName = getFirstName(student.fullName);
        const hasSession = await hasActiveSession(student.whatsappNumber);

        // ✅ Only notify of schedule readiness — no full timetable now
        const message = `Hi ${firstName}, your lecture schedule for tomorrow (${formatLagosDate(
          tomorrowStart
        )}) is ready!`;

        if (hasSession) {
          await sendWhatsAppText({
            to: student.whatsappNumber,
            text: message,
            buttons: [
              {
                id: "view_schedule",
                title: "👁️ View Schedule",
              },
            ],
          });
        } else {
          await sendScheduleReadyTemplate({
            to: student.whatsappNumber,
            studentName: firstName,
          });
        }

        console.log(
          `✅ Tomorrow schedule-ready alert sent to ${student.fullName}`
        );
      }
    } catch (err) {
      console.error("❌ Student evening reminder job failed:", err.message);
    }
  },
  { scheduled: true, timezone: "Africa/Lagos" }
);

module.exports = studentEveningReminderJob;
