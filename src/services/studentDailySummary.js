const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const {
  sendWhatsAppText,
  sendNoLectureNotificationTemplate,
} = require("./whatsapp"); // your helper
const PendingAction = require("../model/pendingActionModel");

// extend dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

function formatLagosTime(date) {
  return dayjs(date).tz("Africa/Lagos").format("HH:mm");
}

function formatLagosDate(date) {
  return dayjs(date).tz("Africa/Lagos").format("dddd, MMM D YYYY");
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

        if (!lectures.length) {
          await sendNoLectureNotificationTemplate({
            to: student.whatsappNumber,
            fullname: student.fullName,
          });

          continue;
        }

        let message = `📚 Hello ${student.fullName}, here’s your schedule for today:\n\n`;

        lectures.forEach((lec, i) => {
          const start = formatLagosTime(lec.startTime);
          const end = formatLagosTime(lec.endTime);

          const status = lec.status.toLowerCase();
          let statusText;
          if (status === "confirmed") statusText = "✅ Confirmed";
          else if (status === "cancelled") statusText = "❌ Cancelled";
          else if (status === "rescheduled") {
            const newDate = formatLagosDate(lec.startTime);
            statusText = `🔄 Rescheduled to ${newDate} (${start}-${end})`;
          } else statusText = "⏳ Pending lecturer's response";

          message += `${i + 1}. ${lec.course} by ${
            lec.lecturer
          } (${start}-${end}) - ${statusText}\n`;
        });

        message += `\n🔔 Click below to get tomorrow’s schedule automatically!`;

        try {
          // Send interactive message with button
          await sendWhatsAppText({
            to: student.whatsappNumber,
            text: message,
            buttons: [
              {
                id: "remind_tomorrow",
                title: "🔔 Remind me tomorrow",
              },
            ],
          });

          console.log(`✅ Daily summary sent to ${student.fullName}`);
        } catch (err) {
          console.error(
            `❌ Failed to send summary to ${student.fullName}:`,
            err.message
          );
        }
      }
    } catch (err) {
      console.error("❌ Student daily summary job failed:", err.message);
    }
  },
  { scheduled: true, timezone: "Africa/Lagos" }
);

module.exports = studentDailySummaryJob;
