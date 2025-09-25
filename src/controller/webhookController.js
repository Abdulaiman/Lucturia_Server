// controllers/webhookController.js
const LectureMessage = require("../model/lectureMessageModel");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const AppError = require("../../utils/app-error");
const { sendStudentClassNotification } = require("../services/whatsapp");

function getFirstName(fullName = "") {
  if (!fullName) return "";
  const first = fullName.trim().split(" ")[0]; // take first part
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(); // capitalize
}
function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true, // 👈 optional: remove this if you want 24h format
  });
}

// Handle webhook verification
exports.verifyWebhook = (req, res, next) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  } else {
    console.error("WEBHOOK_VERIFICATION_FAILED");
    return res.sendStatus(403);
  }
};

// Handle incoming webhook events
exports.handleWebhook = async (req, res, next) => {
  try {
    const body = req.body;
    console.log("📩 Incoming webhook:", JSON.stringify(body, null, 2));

    if (body.object && body.entry && body.entry[0].changes) {
      const changes = body.entry[0].changes;

      for (const change of changes) {
        if (change.value.messages) {
          for (const message of change.value.messages) {
            const type = message.type;

            if (type === "button") {
              const reply = message.button.text;
              const waMessageId = message.context?.id;

              const lectureMessage = await LectureMessage.findOne({
                waMessageId,
              });
              if (!lectureMessage) continue;

              const lecture = await Lecture.findById(
                lectureMessage.lectureId
              ).populate("class");
              if (!lecture) continue;

              console.log(
                `Lecturer responded to lecture ${lecture._id}: ${reply}`
              );

              // --- Update lecture status
              let status = "";
              if (reply.toLowerCase() === "yes") {
                lecture.status = "Confirmed";
                status = "Confirmed ✅";
              } else if (reply.toLowerCase() === "no") {
                lecture.status = "Cancelled";
                status = "Cancelled ❌";
              } else if (reply.toLowerCase().includes("reschedule")) {
                lecture.status = "Rescheduled";
                status = "Rescheduled 📅";
              }
              await lecture.save();

              // --- Notify students
              const students = await User.find({
                class: lecture.class._id,
              }).select("whatsappNumber fullName");

              for (const student of students) {
                await sendStudentClassNotification({
                  to: student.whatsappNumber,
                  studentName: getFirstName(student.fullName),
                  status,
                  course: lecture.course,
                  lecturerName: lecture.lecturer,
                  startTime: formatTime(lecture.startTime),
                  endTime: formatTime(lecture.endTime),
                  location: lecture.location,
                });
              }

              console.log(`📢 Notified ${students.length} students`);
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return next(new AppError(err.message, 500));
  }
};
