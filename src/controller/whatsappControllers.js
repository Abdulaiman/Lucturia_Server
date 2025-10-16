// whatsappHandlers.js

const LectureMessage = require("../model/lectureMessageModel");
const Lecture = require("../model/lectureModel");
const PendingAction = require("../model/pendingActionModel");
const User = require("../model/userModel");
const ProcessedInbound = require("../model/processedInboundModel");
const {
  sendStudentClassConfirmed,
  sendStudentClassCancelled,
  sendStudentClassRescheduled,
  sendLecturerFollowUp,
  sendWhatsAppText,
  notifyStudentsOfContribution,
} = require("../services/whatsapp");
const { getFirstName, formatTime } = require("../../utils/helpers");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

// extend dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

function formatLagosTime(date) {
  return dayjs(date).tz("Africa/Lagos").format("HH:mm");
}

function formatLagosDate(date) {
  return dayjs(date).tz("Africa/Lagos").format("dddd, MMM D YYYY");
}

function toLocalMsisdn(waId) {
  return waId?.startsWith("234") && waId.length === 13
    ? "0" + waId.slice(3)
    : waId;
}

// ---- helpers (place near top of the file) ----
const MAX_TEMPLATE_BODY = 1024; // official WhatsApp template body limit [Meta]
const RESERVED_HEADROOM = 100; // safety buffer under limit
const EFFECTIVE_LIMIT = MAX_TEMPLATE_BODY - RESERVED_HEADROOM; // 924

// Split by sentences while preserving newline tokens
function splitBySentence(text) {
  const parts = [];
  const tokens = String(text).split(/(\n{2,}|\n)/); // keep newlines as tokens
  for (const tk of tokens) {
    if (tk === "\n" || /^\n{2,}$/.test(tk)) {
      parts.push(tk);
      continue;
    }
    // heuristic sentence split: end punctuation + space + capital/digit start
    const sentences = tk.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
    for (const s of sentences) parts.push(s);
  }
  return parts;
}

// Pack text into chunks <= limit, preferring paragraph/sentence/word boundaries
function packChunksPreservingLayout(text, limit = EFFECTIVE_LIMIT) {
  const normalized = String(text).normalize("NFC");
  const paras = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  const canAppend = (piece) => current.length + piece.length <= limit;
  const flush = () => {
    if (current.trim().length) chunks.push(current.trimEnd());
    current = "";
  };

  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    let paraText = i < paras.length - 1 ? para + "\n\n" : para;

    if (paraText.length <= limit) {
      if (canAppend(paraText)) current += paraText;
      else {
        flush();
        current = paraText;
      }
      continue;
    }

    // Paragraph too long: split by sentences, then by words, then hard-split as last resort
    const parts = splitBySentence(paraText);
    for (const part of parts) {
      if (part.length <= limit) {
        if (canAppend(part)) current += part;
        else {
          flush();
          current = part;
        }
      } else {
        const words = part.split(/(\s+)/); // keep spaces
        for (const w of words) {
          if (w.length <= limit) {
            if (canAppend(w)) current += w;
            else {
              flush();
              current = w;
            }
          } else {
            // Hard split giant token
            let start = 0;
            while (start < w.length) {
              const slice = w.slice(start, start + limit);
              if (canAppend(slice)) current += slice;
              else {
                flush();
                current = slice;
              }
              start += limit;
            }
          }
        }
      }
    }
  }
  flush();
  return chunks;
}

// Optional header to help students follow multi-part notes
function annotateParts(chunks) {
  if (chunks.length <= 1) return chunks;
  const n = chunks.length;
  return chunks.map((c, i) => `Part ${i + 1}/${n}\n\n` + c);
}

// ✅ Handle button replies from lecturers
async function handleLecturerButton(message) {
  // 1) Anchor to the original template message that had the buttons
  const triggerId = message?.context?.id;
  if (!triggerId) return; // nothing to correlate

  // 2) Normalize reply
  let reply = "";
  if (message.type === "button" && message.button) {
    reply = message.button.text || message.button.payload;
  } else if (
    message.type === "interactive" &&
    message.interactive?.type === "button_reply"
  ) {
    reply =
      message.interactive.button_reply.title ||
      message.interactive.button_reply.id;
  }
  if (!reply) return;

  // 3) Fetch the lecture via the message sent earlier
  const lectureMessage = await LectureMessage.findOne({
    waMessageId: triggerId,
  });
  if (!lectureMessage) return;

  const lecture = await Lecture.findById(lectureMessage.lectureId).populate(
    "class"
  );
  if (!lecture) return;

  const lower = reply.toLowerCase();

  // 4) Initial decision guard (YES / NO / RESCHEDULE) — process once
  const isInitialDecision =
    lower === "yes" || lower === "no" || lower.includes("reschedule");

  if (isInitialDecision) {
    // Atomically set decisionHandled only if it was false
    const updated = await LectureMessage.updateOne(
      { waMessageId: triggerId, decisionHandled: { $ne: true } },
      { $set: { decisionHandled: true } }
    );

    if (updated.modifiedCount === 0) {
      // Already handled — ignore duplicate webhook
      return;
    }
  }

  // 5) Proceed with business logic (only first time reaches here for initial decision)
  let status = "";
  let notifyFn = null;

  if (lower === "yes") {
    lecture.status = "Confirmed";
    status = "Confirmed ✅";
    notifyFn = sendStudentClassConfirmed;

    await sendLecturerFollowUp({
      to: lecture.lecturerWhatsapp,
      lectureId: lecture._id,
    });
  } else if (lower === "no") {
    lecture.status = "Cancelled";
    status = "Cancelled ❌";
    notifyFn = sendStudentClassCancelled;
  } else if (lower.includes("reschedule")) {
    lecture.status = "Rescheduled";
    status = "Rescheduled 📅";
  } else if (lower.includes("add note")) {
    let pending = await PendingAction.findOne({
      waMessageId: triggerId,
      status: "pending",
    });
    if (!pending) {
      pending = await PendingAction.findOne({
        lecture: lecture._id,
        status: "pending",
      }).sort({ createdAt: -1 });
    }
    if (pending) {
      pending.action = "add_note";
      await pending.save();
    } else {
      await PendingAction.create({
        lecturer: lecture.lecturerWhatsapp,
        lecture: lecture._id,
        action: "add_note",
        waMessageId: triggerId,
        status: "pending",
      });
    }
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "✍️ Please type the note you’d like to add for this lecture.",
    });
    return;
  } else if (lower.includes("add document")) {
    let pending = await PendingAction.findOne({
      waMessageId: triggerId,
      status: "pending",
    });
    if (!pending) {
      pending = await PendingAction.findOne({
        lecture: lecture._id,
        status: "pending",
      }).sort({ createdAt: -1 });
    }
    if (pending) {
      pending.action = "add_document";
      await pending.save();
    } else {
      await PendingAction.create({
        lecturer: lecture.lecturerWhatsapp,
        lecture: lecture._id,
        action: "add_document",
        waMessageId: triggerId,
        status: "pending",
      });
    }
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "📄 Please upload the document file for this lecture.",
    });
    return;
  } else if (lower.includes("no more")) {
    const pending = await PendingAction.findOne({
      waMessageId: triggerId,
      status: "pending",
    });
    if (pending) await pending.save();
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "👌 Got it. No extra notes or documents will be added.",
    });
    return;
  }

  // Save lecture updates
  await lecture.save();

  // Notify students only once (guarded by decisionHandled)
  if (notifyFn) {
    const students = await User.find({ class: lecture.class._id }).select(
      "whatsappNumber fullName"
    );
    for (const student of students) {
      await notifyFn({
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
  }
}

// async function handleLecturerContribution(message) {
//   let waId = message.from; // e.g., '2348032532333'
//   const waMessageId = message.id;
//   let content = null;
//   const type = message.type;

//   // convert incoming number to local 11-digit format
//   if (waId.startsWith("234") && waId.length === 13) {
//     waId = "0" + waId.slice(3); // '2348032532333' => '08032532333'
//   }

//   // find the latest pending action for this lecturer
//   const pending = await PendingAction.findOne({
//     lecturerWhatsapp: waId,
//     status: "pending",
//   })
//     .sort({ createdAt: -1 })
//     .populate("lecture");

//   if (!pending) {
//     console.log(
//       `⚠️ No pending action found for lecturer ${waId}, ignoring message.`
//     );
//     return;
//   }

//   // capture the content
//   if (type === "text") {
//     content = message.text.body;
//     console.log(`📝 Lecturer note captured: ${content}`);
//   } else if (type === "document") {
//     content = {
//       waId: message.document.id, // ✅ renamed for consistency
//       fileName: message.document.filename,
//       mimeType: message.document.mime_type,
//     };
//     console.log(`📄 Lecturer uploaded document: ${content.fileName}`);
//   } else {
//     console.log(`⚠️ Unsupported message type from lecturer: ${type}`);
//     return;
//   }

//   // save to lecture
//   const lecture = pending.lecture;
//   if (!lecture) {
//     console.log(`⚠️ Pending action has no linked lecture, ignoring.`);
//     return;
//   }

//   if (pending.action === "add_note" && type === "text") {
//     lecture.notes = lecture.notes || [];
//     lecture.notes.push({
//       text: content,
//       addedBy: waId,
//       createdAt: new Date(),
//     });
//   } else if (pending.action === "add_document" && type === "document") {
//     lecture.documents = lecture.documents || [];
//     lecture.documents.push(content); // ✅ already structured with waId/fileName/mimeType
//   }

//   await lecture.save();

//   await pending.save();

//   // notify students with the *same content shape* you just saved
//   await notifyStudentsOfContribution(lecture, pending.action, content);

//   // confirm to lecturer
//   await sendWhatsAppText({
//     to: lecture.lecturerWhatsapp,
//     text: "✅ Sent",
//   });
// }

// -----------------
// Handle reschedule submissions (unchanged)
// -----------------

// ✅ Handle reschedule submissions

// ✅ Handle lecturer contributions (idempotent + dedupe)
async function handleLecturerContribution(message) {
  let waId = message.from; // e.g., '2348032532333'
  const waMessageId = message.id; // inbound WAMID
  const type = message.type;
  let content = null;

  // convert incoming number to local 11-digit format
  if (waId && waId.startsWith("234") && waId.length === 13) {
    waId = "0" + waId.slice(3); // '2348032532333' => '08032532333'
  }

  // find the latest pending action for this lecturer
  const pending = await PendingAction.findOne({
    lecturerWhatsapp: waId,
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .populate("lecture");

  if (!pending) {
    console.log(
      `⚠️ No pending action found for lecturer ${waId}, ignoring message.`
    );
    return;
  }

  // Idempotency gate: record this inbound WAMID once
  try {
    await ProcessedInbound.create({
      waMessageId,
      lectureId: pending.lecture?._id,
      from: waId,
      type,
    });
  } catch (err) {
    // Duplicate key -> already processed this inbound message
    if (err && err.code === 11000) {
      console.log(`🔁 Duplicate inbound ${waMessageId} detected, skipping.`);
      return;
    }
    throw err;
  }

  // capture the content
  if (type === "text") {
    content = message.text?.body || "";
    console.log(`📝 Lecturer note captured: ${content}`);
  } else if (type === "document") {
    content = {
      waId: message.document?.id, // WA media/message id
      fileName: message.document?.filename,
      mimeType: message.document?.mime_type,
    };
    console.log(`📄 Lecturer uploaded document: ${content.fileName}`);
  } else {
    console.log(`⚠️ Unsupported message type from lecturer: ${type}`);
    return;
  }

  // save to lecture
  const lecture = pending.lecture;
  if (!lecture) {
    console.log(`⚠️ Pending action has no linked lecture, ignoring.`);
    return;
  }

  let inserted = false;

  if (pending.action === "add_note" && type === "text") {
    const normText = (content || "").trim().replace(/\s+/g, " ");
    const exists =
      Array.isArray(lecture.notes) &&
      lecture.notes.some(
        (n) =>
          typeof n?.text === "string" &&
          (n.addedBy || "") === waId &&
          n.text.trim().replace(/\s+/g, " ") === normText
      );

    if (!exists) {
      lecture.notes = lecture.notes || [];
      lecture.notes.push({
        text: content, // preserve full original note in DB
        addedBy: waId,
        createdAt: new Date(),
      });
      inserted = true;
    } else {
      console.log("ℹ️ Duplicate note detected, not adding.");
    }

    if (!inserted) {
      // Confirm to lecturer even if duplicate to avoid confusion
      await sendWhatsAppText({ to: lecture.lecturerWhatsapp, text: "✅ Sent" });
      return;
    }

    // Persist the saved note before fan-out
    await lecture.save();
    await pending.save();

    // Split into safe chunks that preserve layout and stay under the template body limit
    const chunks = annotateParts(
      packChunksPreservingLayout(content, EFFECTIVE_LIMIT)
    );

    // Fan-out: send each chunk sequentially so order is preserved per student
    for (const part of chunks) {
      await notifyStudentsOfContribution(lecture, "add_note", part);
    }

    // Confirm to lecturer with part count
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: `✅ Sent${chunks.length > 1 ? ` in ${chunks.length} parts` : ""}`,
    });
    return; // done with text path
  } else if (pending.action === "add_document" && type === "document") {
    const exists =
      Array.isArray(lecture.documents) &&
      lecture.documents.some(
        (d) => d?.waId && content?.waId && d.waId === content.waId
      );

    if (!exists) {
      lecture.documents = lecture.documents || [];
      lecture.documents.push(content); // waId/fileName/mimeType
      inserted = true;
    } else {
      console.log("ℹ️ Duplicate document detected by waId, not adding.");
    }
  } else {
    console.log(`⚠️ Action/type mismatch: ${pending.action} vs ${type}`);
    return;
  }

  // Document or other paths: persist, notify once, confirm
  if (inserted) {
    await lecture.save();
    await pending.save();
    await notifyStudentsOfContribution(lecture, pending.action, content);
  } else {
    console.log(
      "ℹ️ No changes persisted due to duplication; notifying lecturer only."
    );
  }

  await sendWhatsAppText({
    to: lecture.lecturerWhatsapp,
    text: "✅ Sent",
  });
}

// ✅ Handle reschedule submissions (idempotent + no-op guard)
async function handleLecturerReschedule(message) {
  // 1) Dedupe by inbound WAMID for this interactive submission
  const inboundId = message.id; // unique WAMID for the submission
  try {
    await ProcessedInbound.create({
      waMessageId: inboundId,
      type: "interactive_reschedule",
      from: message.from,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      console.log(`🔁 Duplicate reschedule inbound ${inboundId}, skipping.`);
      return;
    }
    throw err;
  }

  // 2) Parse interactive native flow payload
  const resData = JSON.parse(message.interactive.nfm_reply.response_json);

  // 3) Anchor to the original outbound message via context.id
  const waMessageId = message.context?.id;
  const lectureMessage = await LectureMessage.findOne({ waMessageId });
  if (!lectureMessage) return;

  const lecture = await Lecture.findById(lectureMessage.lectureId).populate(
    "class"
  );
  if (!lecture) return;

  // 4) Compute new times
  const newStart = new Date(
    `${resData.screen_0_New_Date_0}T${
      resData.screen_0_Class_Starts_1.split("_")[1]
    }`
  );
  const newEnd = new Date(
    `${resData.screen_0_New_Date_0}T${
      resData.screen_0_Class_Ends_2.split("_")[1]
    }`
  );

  // 5) No-op guard (avoid duplicate notifications if nothing changed)
  const unchanged =
    lecture.startTime?.getTime() === newStart.getTime() &&
    lecture.endTime?.getTime() === newEnd.getTime() &&
    (lecture.status || "").toLowerCase() === "rescheduled";

  if (unchanged) {
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "✅ Reschedule received (no changes detected).",
    });
    return;
  }

  // 6) Apply update and notify once
  lecture.status = "Rescheduled";
  lecture.startTime = newStart;
  lecture.endTime = newEnd;

  await lecture.save();

  console.log(
    `📅 Lecture rescheduled: ${lecture.startTime} - ${lecture.endTime}`
  );

  const students = await User.find({ class: lecture.class._id }).select(
    "whatsappNumber fullName"
  );

  for (const student of students) {
    await sendStudentClassRescheduled({
      to: student.whatsappNumber,
      studentName: getFirstName(student.fullName),
      course: lecture.course,
      lecturerName: lecture.lecturer,
      newDate: resData.screen_0_New_Date_0,
      startTime: resData.screen_0_Class_Starts_1.split("_")[1],
      endTime: resData.screen_0_Class_Ends_2.split("_")[1],
      location: lecture.location,
      note: resData.screen_0_Add_note_3 || null,
    });
  }

  console.log(`📢 Notified ${students.length} students of reschedule`);

  // Optional: confirm to lecturer
  await sendWhatsAppText({
    to: lecture.lecturerWhatsapp,
    text: "✅ Reschedule sent",
  });
}

// async function handleStudentKeywordSummary(message) {
//   const waId = message.from; // e.g. "23480..."
//   const local = toLocalMsisdn(waId);

//   const student = await User.findOne({ whatsappNumber: local }).populate(
//     "class"
//   );
//   if (!student || !student.class) {
//     // Optional: send a friendly fallback or ignore
//     return;
//   }

//   const todayStart = dayjs().tz("Africa/Lagos").startOf("day").toDate();
//   const todayEnd = dayjs().tz("Africa/Lagos").endOf("day").toDate();

//   const lectures = await Lecture.find({
//     class: student.class._id,
//     startTime: { $gte: todayStart, $lte: todayEnd },
//   });

//   if (!lectures.length) {
//     await sendWhatsAppText({
//       to: student.whatsappNumber,
//       text: `📌 Hi ${student.fullName}, your lectures for today are yet to be scheduled, Reach out to your reps!`,
//     });
//     return;
//   }

//   let messageOut = `📚 Hello ${
//     student.fullName
//   }, here’s your schedule for ${formatLagosDate(new Date())}:\n\n`;

//   lectures.forEach((lec, i) => {
//     const start = formatLagosTime(lec.startTime);
//     const end = formatLagosTime(lec.endTime);
//     const status = (lec.status || "").toLowerCase();

//     let statusText = "⏳ Pending lecturer's response";
//     if (status === "confirmed") statusText = "✅ Confirmed";
//     else if (status === "cancelled") statusText = "❌ Cancelled";
//     else if (status === "rescheduled") {
//       const newDate = formatLagosDate(lec.startTime);
//       statusText = `🔄 Rescheduled to ${newDate} (${start}-${end})`;
//     }

//     messageOut += `${i + 1}. ${lec.course} by ${
//       lec.lecturer
//     } (${start}-${end}) - ${statusText}\n`;
//   });

//   messageOut += `\n🔔 Tap below to get tomorrow’s schedule automatically!`;

//   await sendWhatsAppText({
//     to: student.whatsappNumber,
//     text: messageOut,
//     buttons: [{ id: "remind_tomorrow", title: "🔔 Remind me tomorrow" }],
//   });
// }

async function handleStudentKeywordSummary(message) {
  // Idempotency: record inbound WAMID once; skip duplicate deliveries
  const inboundId = message.id; // unique per inbound text
  try {
    await ProcessedInbound.create({
      waMessageId: inboundId,
      from: message.from,
      type: "text_keyword",
    });
  } catch (err) {
    if (err && err.code === 11000) {
      console.log(`🔁 Duplicate keyword inbound ${inboundId}, skipping.`);
      return;
    }
    throw err;
  }

  const waId = message.from; // e.g. "23480..."
  const local = toLocalMsisdn(waId);

  const student = await User.findOne({ whatsappNumber: local }).populate(
    "class"
  );
  if (!student || !student.class) {
    // Optional: send a friendly fallback or ignore
    return;
  }

  const todayStart = dayjs().tz("Africa/Lagos").startOf("day").toDate();
  const todayEnd = dayjs().tz("Africa/Lagos").endOf("day").toDate();

  const lectures = await Lecture.find({
    class: student.class._id,
    startTime: { $gte: todayStart, $lte: todayEnd },
  });

  if (!lectures.length) {
    await sendWhatsAppText({
      to: student.whatsappNumber,
      text: `📌 Hi ${student.fullName}, You have no lectures today!`,
    });
    return;
  }

  let messageOut = `📚 Hello ${
    student.fullName
  }, here’s your schedule for ${formatLagosDate(new Date())}:\n\n`;

  lectures.forEach((lec, i) => {
    const start = formatLagosTime(lec.startTime);
    const end = formatLagosTime(lec.endTime);
    const status = (lec.status || "").toLowerCase();

    let statusText = "⏳ Pending lecturer's response";
    if (status === "confirmed") statusText = "✅ Confirmed";
    else if (status === "cancelled") statusText = "❌ Cancelled";
    else if (status === "rescheduled") {
      const newDate = formatLagosDate(lec.startTime);
      statusText = `🔄 Rescheduled to ${newDate} (${start}-${end})`;
    }

    messageOut += `${i + 1}. ${lec.course} by ${
      lec.lecturer
    } (${start}-${end}) - ${statusText}\n`;
  });

  messageOut += `\n🔔 Tap below to get tomorrow’s schedule automatically!`;

  await sendWhatsAppText({
    to: student.whatsappNumber,
    text: messageOut,
    buttons: [{ id: "remind_tomorrow", title: "🔔 Remind me tomorrow" }],
  });
}
// whatsappHandlers.js (excerpt)

// whatsappHandlers.js

async function handleClassRepBroadcast(message) {
  if (message.type !== "text") return;

  const rawText = message.text?.body || "";
  const textTrim = rawText.trim();
  if (!textTrim) return;

  // Never broadcast exact 'summary'
  if (
    textTrim.toLowerCase() === "summary" ||
    textTrim.toLowerCase() === "got it" ||
    textTrim.toLowerCase() === "no" ||
    textTrim.toLowerCase() === "yes" ||
    textTrim.toLowerCase() === "not sure"
  )
    return;

  // Verify sender is a class rep BEFORE idempotency insert
  const local = toLocalMsisdn(message.from);
  const rep = await User.findOne({ whatsappNumber: local }).populate("class");
  if (!rep || !rep.class) return;
  const role = (rep.role || "").toLowerCase();
  if (role !== "class_rep" && role !== "rep" && role !== "classrep") return;

  // Idempotency by inbound WAMID (only for actual rep messages)
  const inboundId = message.id; // WAMID
  try {
    await ProcessedInbound.create({
      waMessageId: inboundId,
      from: message.from,
      type: "class_rep_broadcast",
    });
  } catch (err) {
    if (err && err.code === 11000) {
      console.log(`🔁 Duplicate class-rep inbound ${inboundId}, skipping.`);
      return;
    }
    throw err;
  }

  const classmates = await User.find({
    class: rep.class._id,
    role: { $in: ["student", "admin", "Student", "STUDENT"] }, // students only
  }).select("whatsappNumber fullName");

  if (!classmates.length) {
    await sendWhatsAppText({
      to: rep.whatsappNumber,
      text: "ℹ️ No students found in your class to broadcast to.",
    });
    return;
  }

  const repName = getFirstName(rep.fullName || "Class Rep");
  const payload = `📣 From your Class Rep, ${repName}:\n\n${textTrim}`;

  for (const student of classmates) {
    if (
      !student.whatsappNumber ||
      student.whatsappNumber === rep.whatsappNumber
    )
      continue;
    await sendWhatsAppText({ to: student.whatsappNumber, text: payload });
  }

  await sendWhatsAppText({
    to: rep.whatsappNumber,
    text: "✅ Your message has been sent to the class.",
  });
}

module.exports = {
  handleLecturerButton,
  handleLecturerReschedule,
  handleLecturerContribution,
  handleStudentKeywordSummary,
  handleClassRepBroadcast,
};
