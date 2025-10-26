const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const {
  sendWhatsAppText,
  sendNoLectureNotificationTemplate,
  sendScheduleReadyTemplate, // ✅ NEW
  hasActiveSession, // ✅ NEW
} = require("./whatsapp");
const PendingAction = require("../model/pendingActionModel");

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

// 6AM daily (local Africa/Lagos time)
const studentDailySummaryJob = cron.schedule(
  "00 06 * * *",
  async () => {
    console.log("📤 Running student daily summary job...");

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

        // ✅ Check if user has active session
        const hasSession = await hasActiveSession(student.whatsappNumber);

        // ========== NO LECTURES SCENARIO ==========
        if (!lectures.length) {
          if (hasSession) {
            // Free message (no cost)
            await sendWhatsAppText({
              to: student.whatsappNumber,
              text: `📌 Hi ${student.fullName}, you have no lectures scheduled for today!`,
              buttons: [
                {
                  id: "remind_tomorrow",
                  title: "🔔 Remind me tomorrow",
                },
              ],
            });
          } else {
            // Template (costs money)
            await sendNoLectureNotificationTemplate({
              to: student.whatsappNumber,
              fullname: student.fullName,
            });
          }
          console.log(`✅ No lecture message sent to ${student.fullName}`);
          continue;
        }

        // ========== HAS LECTURES SCENARIO ==========
        // Send SHORT "schedule ready" prompt only
        const firstName = getFirstName(student.fullName);

        if (hasSession) {
          // Free message with View button
          await sendWhatsAppText({
            to: student.whatsappNumber,
            text: `Hi ${firstName}, your lecture schedule for today is ready! 📚\n\nTap "View Schedule" to see your classes.`,
            buttons: [
              {
                id: "view_schedule",
                title: "👁️ View Schedule",
              },
            ],
          });
        } else {
          // Template with View button (costs money, but opens session)
          await sendScheduleReadyTemplate({
            to: student.whatsappNumber,
            studentName: firstName,
          });
        }

        console.log(`✅ Schedule ready prompt sent to ${student.fullName}`);
      }
    } catch (err) {
      console.error("❌ Student daily summary job failed:", err.message);
    }
  },
  { scheduled: true, timezone: "Africa/Lagos" }
);

module.exports = studentDailySummaryJob;
