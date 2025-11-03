const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const { sendWhatsAppText } = require("./whatsapp");

dayjs.extend(utc);
dayjs.extend(timezone);

function formatLagosTime(date) {
  return dayjs(date).tz("Africa/Lagos").format("HH:mm");
}

function formatLagosDate(date) {
  return dayjs(date).tz("Africa/Lagos").format("dddd, MMM D YYYY");
}

function getFirstName(fullName) {
  if (!fullName) return "";
  const first = fullName.trim().split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// =========================
// 6PM DAILY REMINDER JOB
// =========================
const studentEveningReminderJob = cron.schedule(
  "00 18 * * *", // 6:00 PM Africa/Lagos
  async () => {
    console.log("📤 Running student evening reminder job...");

    // Tomorrow's time range
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

        // If no lectures tomorrow, skip silently
        if (!lectures.length) continue;
        let statusText = "⏳ Pending lecturer's response";
        // Build message text
        const firstName = getFirstName(student.fullName);
        let message = `📅 Hi ${firstName}, here’s your lecture schedule for tomorrow (${formatLagosDate(
          tomorrowStart
        )}):\n\n`;

        lectures.forEach((lec, i) => {
          const start = formatLagosTime(lec.startTime);
          const end = formatLagosTime(lec.endTime);
          message += `${i + 1}. ${lec.course} by ${
            lec.lecturer
          } (${start}-${end}) - ${statusText}\n`;
        });

        message +=
          "\n🕓 A reminder has been sent to your lecturers — we'll update you as they confirm their schedules.";

        // Send as plain WhatsApp text (no template)
        await sendWhatsAppText({
          to: student.whatsappNumber,
          text: message,
          buttons: [
            {
              id: "Got_it",
              title: "Got it",
            },
          ],
        });

        console.log(`✅ Tomorrow's reminder sent to ${student.fullName}`);
      }
    } catch (err) {
      console.error("❌ Student evening reminder job failed:", err.message);
    }
  },
  { scheduled: true, timezone: "Africa/Lagos" }
);

module.exports = studentEveningReminderJob;
