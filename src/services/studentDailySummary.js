// controllers/studentDailySummaryJob.js
const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const {
  sendWhatsAppText,
  sendNoLectureNotificationTemplate,
  hasActiveSession,
} = require("./whatsapp");
const { buildScheduleText } = require("../controller/whatsappControllers");

dayjs.extend(utc);
dayjs.extend(timezone);

const studentDailySummaryJob = cron.schedule(
  "00 06 * * *", // 6 AM
  async () => {
    console.log("📤 Running student daily (today) summary job...");

    const todayStart = dayjs().tz("Africa/Lagos").startOf("day").toDate();
    const todayEnd = dayjs().tz("Africa/Lagos").endOf("day").toDate();

    try {
      const students = await User.find().populate("class");

      for (const student of students) {
        if (!student.whatsappNumber || !student.class) continue;

        const lectures = await Lecture.find({
          class: student.class._id,
          startTime: { $gte: todayStart, $lte: todayEnd },
        });

        if (!lectures.length) {
          const hasSession = await hasActiveSession(student.whatsappNumber);

          if (hasSession) {
            await sendWhatsAppText({
              to: student.whatsappNumber,
              text: `📌 Hi ${student.fullName}, you have no lectures scheduled for today!`,
              buttons: [
                { id: "remind_tomorrow", title: "🔔 Remind me tomorrow" },
              ],
            });
          } else {
            await sendNoLectureNotificationTemplate({
              to: student.whatsappNumber,
              fullname: student.fullName,
            });
          }
          console.log(`✅ No-lecture msg sent → ${student.fullName}`);
          continue;
        }

        // ✅ AUTO-SEND full schedule text (no button)
        const scheduleText = await buildScheduleText(
          student,
          lectures,
          todayStart
        );

        await sendWhatsAppText({
          to: student.whatsappNumber,
          text: scheduleText,
          buttons: [
            {
              id: "Got_it",
              title: "Got it",
            },
          ],
        });

        console.log(`✅ Full schedule sent (6AM) → ${student.fullName}`);
      }
    } catch (err) {
      console.error("❌ Student daily summary job failed:", err.message);
    }
  },
  { scheduled: true, timezone: "Africa/Lagos" }
);

module.exports = studentDailySummaryJob;
