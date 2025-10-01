// controllers/webhookController.js
const LectureMessage = require("../model/lectureMessageModel");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const AppError = require("../../utils/app-error");
const {
  sendStudentClassCancelled,
  sendStudentClassConfirmed,
  sendStudentClassRescheduled,
  sendLecturerFollowUp,
} = require("../services/whatsapp");
const {
  handleLecturerButton,
  handleLecturerReschedule,
  handleLecturerContribution,
  handleStudentKeywordSummary,
} = require("./whatsappControllers");

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
      for (const change of body.entry[0].changes) {
        if (!change.value.messages) continue;

        for (const message of change.value.messages) {
          console.log(message);

          // 0) Student keyword: "summary" (case-insensitive)
          if (message.type === "text") {
            const bodyText = (message.text?.body || "").trim().toLowerCase();
            if (bodyText.includes("summary")) {
              await handleStudentKeywordSummary(message);
              continue; // short-circuit so lecturer handlers don't run
            }
          }

          // 1) Lecturer buttons (yes/no/reschedule and follow-ups)
          if (
            message.type === "button" ||
            (message.type === "interactive" &&
              message.interactive?.type === "button_reply")
          ) {
            await handleLecturerButton(message);
          }

          // 2) Lecturer reschedule flow (NFM reply)
          if (
            message.type === "interactive" &&
            message.interactive?.type === "nfm_reply"
          ) {
            await handleLecturerReschedule(message);
          }

          // 3) Lecturer contribution (text/doc)
          if (message.type === "text" || message.type === "document") {
            await handleLecturerContribution(message);
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
