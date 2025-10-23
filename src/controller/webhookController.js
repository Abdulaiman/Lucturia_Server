// controllers/webhookController.js
const LectureMessage = require("../model/lectureMessageModel");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const AppError = require("../../utils/app-error");
const PendingAction = require("../model/pendingActionModel"); // used to prioritize contribution flow

const {
  handleLecturerButton,
  handleLecturerReschedule,
  handleLecturerContribution,
  handleStudentKeywordSummary,
  handleClassRepBroadcast,
  handleStudentViewSchedule,
} = require("./whatsappControllers");

// Helpers (local; keep consistent with your shared utils if needed)
function toLocalMsisdn(waId) {
  return waId?.startsWith("234") && waId.length === 13
    ? "0" + waId.slice(3)
    : waId;
}

function getFirstName(fullName = "") {
  if (!fullName) return "";
  const first = fullName.trim().split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true, // toggle if you prefer 24h
  });
}

// Add near other helper functions (toLocalMsisdn, getFirstName, etc.)
async function updateUserSession(phoneNumber) {
  const local = toLocalMsisdn(phoneNumber);
  try {
    await User.findOneAndUpdate(
      { whatsappNumber: local },
      { $set: { lastMessageTime: Date.now() } },
      { upsert: false }
    );
    console.log(`🔄 Session updated for ${local}`);
  } catch (err) {
    console.error(`❌ Failed to update session for ${local}:`, err.message);
  }
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
          await updateUserSession(message.from);
          // 0) Exact keyword: "summary" (case-insensitive)
          if (message.type === "text") {
            const bodyText = (message.text?.body || "").trim();
            if (bodyText && bodyText.toLowerCase() === "summary") {
              await handleStudentKeywordSummary(message); // idempotent by inbound WAMID
              continue; // stop other handlers, including class-rep broadcast
            }

            // 0a) If lecturer has a pending contribution, handle it and stop
            const local = toLocalMsisdn(message.from);
            const pending = await PendingAction.findOne({
              lecturerWhatsapp: local,
              status: "pending",
            }).sort({ createdAt: -1 });
            if (pending) {
              await handleLecturerContribution(message); // idempotent by inbound WAMID
              continue; // ensures only one handler claims this WAMID
            }

            // 0b) Otherwise, allow class rep broadcast (no-op if sender isn't a rep)
            await handleClassRepBroadcast(message); // idempotent by inbound WAMID after role check
          }

          // 1) Lecturer buttons (yes/no/reschedule and follow-ups)
          if (
            message.type === "button" ||
            (message.type === "interactive" &&
              message.interactive?.type === "button_reply")
          ) {
            await handleLecturerButton(message);
            await handleStudentViewSchedule(message);
          }

          // 2) Lecturer reschedule flow (NFM reply)
          if (
            message.type === "interactive" &&
            message.interactive?.type === "nfm_reply"
          ) {
            await handleLecturerReschedule(message);
          }

          // 3) Lecturer contribution (documents or any non-text content)
          // Text contributions are handled earlier when a pending action exists.
          if (message.type === "document") {
            await handleLecturerContribution(message);
          }
        }
      }
    }

    // Always 200 to avoid webhook retries
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return next(new AppError(err.message, 500));
  }
};
