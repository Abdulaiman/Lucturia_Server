const cron = require("node-cron");
const dayjs = require("dayjs");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const { sendWhatsAppText } = require("./whatsapp"); // your helper
const PendingAction = require("../model/pendingActionModel");

// 6AM daily
const studentDailySummaryJob = cron.schedule(
  "56 10 * * *",
  async () => {
    console.log("📤 Running student daily summary job...");

    const todayStart = dayjs().startOf("day").toDate();
    const todayEnd = dayjs().endOf("day").toDate();

    try {
      const students = await User.find().populate("class");

      for (const student of students) {
        if (!student.whatsappNumber || !student.class) continue;

        const lectures = await Lecture.find({
          class: student.class._id,
          startTime: { $gte: todayStart, $lte: todayEnd },
        });

        if (!lectures.length) {
          await sendWhatsAppText({
            to: student.whatsappNumber,
            text: `📌 Hi ${student.fullName}, you have no lectures today!`,
          });
          continue;
        }

        let message = `📚 Hello ${student.fullName}, here’s your schedule for today:\n\n`;

        lectures.forEach((lec, i) => {
          const start = new Date(lec.startTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const end = new Date(lec.endTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          const status = lec.status.toLowerCase();
          let statusText;
          if (status === "confirmed") statusText = "✅ Confirmed";
          else if (status === "cancelled") statusText = "❌ Cancelled";
          else if (status === "rescheduled") {
            const newDate = new Date(lec.startTime).toLocaleDateString();
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
