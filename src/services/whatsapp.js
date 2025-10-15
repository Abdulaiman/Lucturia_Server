// services/whatsapp.js
const dotenv = require("dotenv");
dotenv.config();
const axios = require("axios");
const FormData = require("form-data");
const Class = require("../model/classModel");
const Lecture = require("../model/lectureModel");
const User = require("../model/userModel");
const LectureMessage = require("../model/lectureMessageModel");
const PendingAction = require("../model/pendingActionModel");
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

// Helper: download file from WhatsApp servers
async function downloadMedia(mediaId) {
  // Step 1: Get the media URL
  const mediaUrlRes = await axios.get(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
    }
  );

  const mediaUrl = mediaUrlRes.data.url;

  // Step 2: Download the file bytes
  const fileRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
  });

  return fileRes.data; // raw file buffer
}

// Helper: re-upload file to WhatsApp

async function uploadMedia(fileBuffer, fileName, mimeType) {
  const formData = new FormData();

  // WhatsApp requires this param
  formData.append("messaging_product", "whatsapp");

  // The actual file
  formData.append("file", fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const response = await axios.post(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/media`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        ...formData.getHeaders(),
      },
    }
  );

  return response.data.id; // ✅ mediaId for sending later
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
    console.log(err.response);
    console.error("❌ sendLecturerClassNotification error:", err.message);
    throw err; // rethrow so caller (controller) can catch it
  }
}

async function sendStudentClassConfirmed({
  to,
  studentName,
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
        name: "student_class_notification_confirmed",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: studentName }, // {{1}}
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
    d;
    console.error("❌ sendStudentClassConfirmed error:", err.message);
    throw new AppError("Failed to send student class notification", 500);
  }
}
async function sendStudentClassCancelled({
  to,
  studentName,
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
        name: "template_name_student_class_notification_cancelled",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: studentName }, // {{1}}
              { type: "text", text: course }, // {{2}}
              { type: "text", text: lecturerName }, // {{3}}
              { type: "text", text: startTime }, // {{4}}
              { type: "text", text: endTime }, // {{5}}
              { type: "text", text: location }, // {{6}}
            ],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: "GOT_IT" }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [{ type: "payload", payload: "NEED_HELP" }],
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
    console.log(err.response);
    console.error("❌ sendStudentClassCancelled error:", err.message);
    throw new AppError("Failed to send student class cancellation notice", 500);
  }
}

async function sendStudentClassRescheduled({
  to,
  studentName,
  course,
  lecturerName,
  newDate,
  startTime,
  endTime,
  location,
  note,
}) {
  try {
    const formattedTo = formatPhoneNumber(to);

    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "template",
      template: {
        name: "student_class_notification_rescheduled",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: studentName }, // {{1}}
              { type: "text", text: course }, // {{2}}
              { type: "text", text: lecturerName }, // {{3}}
              { type: "text", text: newDate }, // {{4}}
              { type: "text", text: startTime }, // {{5}}
              { type: "text", text: endTime }, // {{6}}
              { type: "text", text: location }, // {{7}}
              { type: "text", text: note || "No additional notes." }, // {{8}}
            ],
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
    console.error("❌ sendStudentClassRescheduled error:", err.message);
    throw new AppError(
      "Failed to send student class reschedule notification",
      500
    );
  }
}

// services/whatsapp.js (or similar)
async function sendLecturerFollowUp({ to, lectureId }) {
  console.log("➡️ sendLecturerFollowUp called", { to, lectureId });
  if (!to) {
    console.error("✋ sendLecturerFollowUp: missing 'to' phone number");
    throw new Error("Missing recipient phone number");
  }
  if (!process.env.WHATSAPP_PHONE_ID) {
    console.error("✋ WHATSAPP_PHONE_ID is not set");
  }
  console.log("WHATSAPP_API_URL:", WHATSAPP_API_URL);

  const formattedTo = (() => {
    try {
      return formatPhoneNumber(to);
    } catch (e) {
      console.error("✋ formatPhoneNumber error:", e.message);
      throw e;
    }
  })();

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Would you like to add anything for the students?" },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: `add_note_${lectureId}`, title: "➕ Add Note" },
          },
          {
            type: "reply",
            reply: {
              id: `add_document_${lectureId}`,
              title: "📄 Add Document",
            },
          },
          {
            type: "reply",
            reply: { id: `no_more_${lectureId}`, title: "❌ No" },
          },
        ],
      },
    },
  };

  try {
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const waMessageId = response?.data?.messages?.[0]?.id;
    if (waMessageId) {
      // create LectureMessage for mapping (like you already did)
      await LectureMessage.create({
        lectureId,
        waMessageId,
        recipient: formattedTo,
        type: "followup",
      });

      // create a PendingAction to indicate we are awaiting the lecturer's choice/input
      // include lecturer (if available) for easier matching later
      try {
        const lecture = await Lecture.findById(lectureId).select(
          "lecturer lecturerWhatsapp"
        );
        let pendingPayload = {
          lecture: lectureId,
          action: "awaiting_choice", // initial state
          waMessageId,
          status: "pending",
          lecturerWhatsapp: lecture.lecturerWhatsapp,
        };

        // avoid duplicate pending actions for same waMessageId
        const exists = await PendingAction.findOne({ waMessageId });
        if (!exists) {
          await PendingAction.create(pendingPayload);
          console.log(
            "🕒 PendingAction created (awaiting_choice) for follow-up:",
            waMessageId
          );
        } else {
          console.log(
            "ℹ️ PendingAction already exists for waMessageId:",
            waMessageId
          );
        }
      } catch (e) {
        console.error("❌ Failed to create PendingAction:", e);
        // non-fatal — continue
      }
    }

    console.log(
      "✅ Follow-up sent. response.data:",
      JSON.stringify(response.data, null, 2)
    );
    return response.data;
  } catch (err) {
    console.error("❌ sendLecturerFollowUp - request failed");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Headers:", err.response.headers);
      console.error("Body:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("Error message:", err.message);
    }
    console.error("Full error stack:", err.stack);
    throw err;
  }
}

/**
 * Send plain text WhatsApp message (wrapper for lecturer responses)
 */
async function sendWhatsAppText({ to, text, buttons }) {
  const formattedTo = formatPhoneNumber(to);

  try {
    let response;

    if (buttons && buttons.length) {
      // Interactive button message
      const payload = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: buttons.map((b, idx) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };

      response = await axios.post(WHATSAPP_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
    } else {
      // Plain text fallback
      const payload = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "text",
        text: { body: text },
      };

      response = await axios.post(WHATSAPP_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
    }

    console.log("✅ WhatsApp message sent:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "❌ sendWhatsAppText error:",
      err.response?.data || err.message
    );
    throw new AppError(
      err.response?.data?.error?.message || "Failed to send WhatsApp text",
      500
    );
  }
}

async function sendWhatsAppDocument({
  to,
  documentId,
  filename,
  mimeType,
  caption,
}) {
  try {
    console.log({ to, documentId, filename, mimeType });
    const formattedTo = formatPhoneNumber(to);

    // Step 1: Download lecturer’s file
    const fileBuffer = await downloadMedia(documentId);

    // Step 2: Upload to our WABA
    const newMediaId = await uploadMedia(fileBuffer, filename, mimeType);
    console.log("📂 Uploaded, newMediaId =", newMediaId);

    // Step 3: Send to student
    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "document",
      document: {
        id: newMediaId,
        filename, // ✅ required
        caption: caption || "", // ✅ optional
      },
    };

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ WhatsApp document sent:", response.data);
    return response.data;
  } catch (err) {
    console.error(
      "❌ sendWhatsAppDocument error:",
      err.response?.data || err.message
    );
    throw new AppError("Failed to send WhatsApp document", 500);
  }
}

// Send a text-only lecturer update using a Utility template
async function sendLecturerUpdateNoteTemplate({
  to,
  course,
  lecturerName,
  noteText,
}) {
  const formattedTo = formatPhoneNumber(to);
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "template",
    template: {
      name: "lecturer_updates",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: course }, // {{1}}
            { type: "text", text: lecturerName }, // {{2}}
            { type: "text", text: noteText }, // {{3}}
          ],
        },
        // Optionally add button components here if your template defines them
      ],
    },
  };

  const resp = await axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  return resp.data;
}

// async function notifyStudentsOfContribution(lecture, action, content) {
//   const students = await User.find({ class: lecture.class }).select(
//     "whatsappNumber fullName"
//   );

//   for (const student of students) {
//     if (action === "add_note") {
//       await sendWhatsAppText({
//         to: student.whatsappNumber,
//         text: `📝 New note for *${lecture.course}* from ${lecture.lecturer}:\n\n${content}`,
//       });
//     } else if (action === "add_document") {
//       await sendWhatsAppDocument({
//         to: student.whatsappNumber,
//         documentId: content.waId, // the WhatsApp media id
//         filename: content.fileName,
//         mimeType: content.mimeType,
//         caption: `📝 New document for *${lecture.course}* from ${lecture.lecturer}`,
//       });
//     }
//   }

//   console.log(`📢 Shared ${action} with ${students.length} students`);
// }

// Send a document via a template with DOCUMENT header
async function sendLecturerUpdateDocumentTemplate({
  to,
  course,
  lecturerName,
  sourceMediaId,
  filename,
  mimeType,
}) {
  const formattedTo = formatPhoneNumber(to);

  // 1) Download the lecturer’s media (from their waId) and 2) upload to your WABA to get a new media id
  const fileBuffer = await downloadMedia(sourceMediaId);
  const newMediaId = await uploadMedia(fileBuffer, filename, mimeType);

  // 3) Send the template with a DOCUMENT header parameter
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "template",
    template: {
      name: "lecturer_update_document", // create/approve this template with DOCUMENT header
      language: { code: "en_US" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: {
                id: newMediaId,
                filename, // optional but recommended on documents
              },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: course }, // {{1}}
            { type: "text", text: lecturerName }, // {{2}}
            { type: "text", text: "📄 See attached document." }, // {{2}}
          ],
        },
        // Optionally include buttons if your template defines them
      ],
    },
  };

  const resp = await axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  return resp.data;
}

async function notifyStudentsOfContribution(lecture, action, content) {
  const students = await User.find({ class: lecture.class }).select(
    "whatsappNumber fullName"
  );
  const tasks = [];

  for (const student of students) {
    if (action === "add_note") {
      tasks.push(
        sendLecturerUpdateNoteTemplate({
          to: student.whatsappNumber,
          course: lecture.course,
          lecturerName: lecture.lecturer,
          noteText: content, // plain text body
        })
      );
    } else if (action === "add_document") {
      tasks.push(
        sendLecturerUpdateDocumentTemplate({
          to: student.whatsappNumber,
          course: lecture.course,
          lecturerName: lecture.lecturer,
          sourceMediaId: content.waId, // original WhatsApp media id from lecturer
          filename: content.fileName,
          mimeType: content.mimeType,
        })
      );
    }
  }

  await Promise.allSettled(tasks);
  console.log(`📢 Shared ${action} with ${students.length} students`);
}

// services/whatsapp.js (add this alongside your other send* functions)
async function sendLecturerReminderTemplate({
  to,
  lecturerName,
  course,
  classTitle,
  startTime,
  endTime,
  location,
}) {
  const formattedTo = formatPhoneNumber(to);

  const payload = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: "template",
    template: {
      name: "lecturer_reminder", // your new approved template
      language: { code: "en_US" },
      components: [
        // Header is "None" in your template; omit header component
        {
          type: "body",
          parameters: [
            { type: "text", text: lecturerName }, // {{1}}
            { type: "text", text: course }, // {{2}}
            { type: "text", text: classTitle }, // {{3}}
            { type: "text", text: startTime }, // {{4}}
            { type: "text", text: endTime }, // {{5}}
            { type: "text", text: location }, // {{6}}
          ],
        },
        // If your template defines quick-reply buttons (Yes/No/Reschedule), you do not
        // need to pass button parameters unless you included payload parameters.
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
}
async function sendNoLectureNotificationTemplate({ to, fullname }) {
  const formattedTo = formatPhoneNumber(to);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedTo,
    type: "template",
    template: {
      name: "no_lecture", // must match your approved template name
      language: { code: "en_US" }, // must match template language
      // Header is static text in the template; no header parameters needed
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: fullname }, // {{1}}
          ],
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
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppText,
  sendAuthOtpTemplate,
  getTemplates,
  sendWelcomeTemplate,
  sendLecturerWelcomeTemplate,
  sendLecturerClassNotification,
  sendStudentClassConfirmed,
  sendStudentClassCancelled,
  sendStudentClassRescheduled,
  sendLecturerFollowUp,
  notifyStudentsOfContribution,
  sendLecturerReminderTemplate,
  sendNoLectureNotificationTemplate,
};
