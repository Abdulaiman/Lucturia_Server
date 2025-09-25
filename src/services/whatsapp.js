// services/whatsapp.js
const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");
const Class = require("../model/classModel");
const LectureMessage = require("../model/lectureMessageModel");
const AppError = require("../../utils/app-error");
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WABA_ID = process.env.WABA_ID;

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;
const TEMPLATE_API_URL = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;

/**
 * Format phone number to international format (Nigeria only)
 */
function formatPhoneNumber(phone) {
  let cleaned = phone
    .toString()
    .trim()
    .replace(/[^0-9]/g, "");
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  if (!cleaned.startsWith("234")) {
    throw new Error("Phone number must be Nigerian (start with 0 or 234)");
  }
  return cleaned;
}

/**
 * Send plain text WhatsApp message
 */
async function sendWhatsAppMessage(to, body) {
  const formattedTo = formatPhoneNumber(to);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("WhatsApp message sent:", response.data);
    return response.data;
  } catch (err) {
    console.error("WhatsApp API Error:", err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || "Failed to send WhatsApp message"
    );
  }
}

async function sendAuthOtpTemplate(to, templateName, otpCode) {
  const formattedTo = formatPhoneNumber(to);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: otpCode, // ✅ OTP in the body
            },
          ],
        },
        {
          type: "button",
          sub_type: "url", // ✅ OTP button must be url type
          index: "0",
          parameters: [
            {
              type: "text",
              text: otpCode, // ✅ OTP also in button
            },
          ],
        },
      ],
    },
  };

  try {
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    console.log("✅ Auth OTP template sent:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "❌ WhatsApp Auth Template Error:",
      err.response?.data || err.message
    );
    throw new Error(
      err.response?.data?.error?.message || "Failed to send auth template"
    );
  }
}
async function sendWelcomeTemplate(to, name, className) {
  const formattedTo = formatPhoneNumber(to);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "template",
    template: {
      name: "welcome",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "text",
              parameter_name: "name", // 👈 matches {{name}}
              text: name,
            },
          ],
        },
        {
          type: "body",
          parameters: [
            {
              type: "text",
              parameter_name: "class", // 👈 matches {{class}}
              text: className,
            },
          ],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
        },
      ],
    },
  };

  try {
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    console.log("✅ Welcome template sent:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "❌ WhatsApp Welcome Template Error:",
      err.response?.data || err.message
    );
    throw new Error(
      err.response?.data?.error?.message || "Failed to send welcome template"
    );
  }
}

/**
 * Get list of templates and their approval status
 */
async function getTemplates() {
  try {
    const response = await axios.get(
      `${TEMPLATE_API_URL}?access_token=${WHATSAPP_TOKEN}`
    );
    console.log("Templates list:", response.data);
    return response.data;
  } catch (err) {
    console.error("Get templates error:", err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message || "Failed to get templates"
    );
  }
}

async function sendLecturerWelcomeTemplate(to, lecturerName, className) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: "lecturer_welcome",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "text",
              parameter_name: "name", // 👈 matches {{name}}
              text: lecturerName,
            },
          ],
        },
        {
          type: "body",
          parameters: [
            {
              type: "text",
              parameter_name: "class", // 👈 matches {{class}}
              text: className,
            },
          ],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
        },
      ],
    },
  };

  try {
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    console.log("✅ Lecturer welcome template sent:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "❌ WhatsApp Lecturer Welcome Error:",
      err.response?.data || err.message
    );
    throw new Error(
      err.response?.data?.error?.message ||
        "Failed to send lecturer welcome template"
    );
  }
}

async function sendLecturerClassNotification({
  to,
  lecturerName,
  course,
  classId,
  startTime,
  endTime,
  location,
  lectureId,
}) {
  try {
    // Fetch the class document
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      throw new AppError("Class not found for the given ID", 404);
    }

    const classTitle = classDoc.title;
    const formattedTo = formatPhoneNumber(to);

    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "template",
      template: {
        name: "lecturer_class_notification",
        language: { code: "en_US" },
        components: [
          { type: "header", parameters: [] },
          {
            type: "body",
            parameters: [
              { type: "text", text: lecturerName },
              { type: "text", text: course },
              { type: "text", text: classTitle },
              { type: "text", text: startTime },
              { type: "text", text: endTime },
              { type: "text", text: location },
            ],
          },
          { type: "button", sub_type: "quick_reply", index: "0" }, // Yes
          { type: "button", sub_type: "quick_reply", index: "1" }, // No
          { type: "button", sub_type: "flow", index: "2" }, // Reschedule
        ],
      },
    };

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    // ✅ Save to LectureMessage collection
    if (response?.data?.messages?.[0]?.id) {
      try {
        const lectureMsg = await LectureMessage.create({
          lectureId,
          waMessageId: response.data.messages[0].id,
          recipient: formattedTo,
        });
      } catch (dbErr) {
        // optional: throw so you know it failed, or just log and continue
        throw new AppError("Could not save lecture message", 500);
      }
    } else {
      console.warn(
        "⚠️ No WhatsApp message ID returned in response:",
        response.data
      );
    }

    return response.data;
  } catch (err) {
    console.error("❌ sendLecturerClassNotification error:", err.message);
    throw err; // rethrow so caller (controller) can catch it
  }
}

async function sendStudentClassNotification({
  to,
  studentName,
  status, // e.g. "Confirmed ✅" or "Cancelled ❌"
  course,
  lecturerName,
  startTime,
  endTime,
  location,
}) {
  try {
    const formattedTo = formatPhoneNumber(to);

    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "template",
      template: {
        name: "student_class_notification",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: studentName }, // {{1}}
              { type: "text", text: status }, // {{2}}
              { type: "text", text: course }, // {{3}}
              { type: "text", text: lecturerName }, // {{4}}
              { type: "text", text: startTime }, // {{5}}
              { type: "text", text: endTime }, // {{6}}
              { type: "text", text: location }, // {{7}}
            ],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: "YES" }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [{ type: "payload", payload: "NO" }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "2",
            parameters: [{ type: "payload", payload: "NOT_SURE" }],
          },
        ],
      },
    };

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (err) {
    console.error("❌ sendStudentClassNotification error:", err.message);
    throw new AppError("Failed to send student class notification", 500);
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendAuthOtpTemplate,
  getTemplates,
  sendWelcomeTemplate,
  sendLecturerWelcomeTemplate,
  sendLecturerClassNotification,
  sendStudentClassNotification,
};
