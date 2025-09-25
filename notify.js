// testLecturerNotification.js
const axios = require("axios");
require("dotenv").config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

// Hardcoded test data
const testPhone = "08032532333"; // replace with your WhatsApp number
const lecturerName = "Prof Baba Isah";
const course = "Occupational Health";
const className = "MBBS/BDS Class Of 2020/21";
const startTime = "08:30 AM";
const endTime = "10:30 AM";
const location = "New Hall";

/**
 * Format Nigerian phone number to international format
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

async function sendLecturerClassNotification() {
  const formattedTo = formatPhoneNumber(testPhone);

  const payload = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: "template",
    template: {
      name: "lecturer_class_notification",
      language: { code: "en_US" },
      components: [
        {
          type: "header",
          parameters: [],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: lecturerName }, // {{2}}
            { type: "text", text: course }, // {{2}}
            { type: "text", text: className }, // {{3}}
            { type: "text", text: startTime }, // {{4}}
            { type: "text", text: endTime }, // {{5}}
            { type: "text", text: location }, // {{6}}
          ],
        },
        // Buttons
        { type: "button", sub_type: "quick_reply", index: "0" }, // Yes ✅
        { type: "button", sub_type: "quick_reply", index: "1" }, // No ❌
        { type: "button", sub_type: "flow", index: "2" }, // Reschedule ⏳
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
    console.log("✅ Lecturer class notification sent:", response.data);
  } catch (err) {
    console.error(
      "❌ WhatsApp Lecturer Class Notification Error:",
      err.response?.data || err.message
    );
  }
}

// Run the test
sendLecturerClassNotification();
