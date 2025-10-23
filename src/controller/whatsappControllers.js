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
  sendLecturerCancelNotePrompt,
  sendStudentClassConfirmedSmart,
  sendStudentClassCancelledSmart,
  sendStudentClassRescheduledSmart,
  hasActiveSession,
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

// Replace newlines/tabs; collapse long whitespace; strip control chars
function sanitizeForWhatsAppTemplate(text) {
  let s = String(text);

  // 1) Remove forbidden line breaks/tabs (use a visible inline separator)
  s = s.replace(/\r\n|\r|\n/g, " • ");
  s = s.replace(/\t/g, " ");

  // 2) Strip ASCII control chars except newline/tab (already removed)
  s = s.replace(/[\u0000-\u0009\u000B-\u000C\u000E-\u001F\u007F]/g, "");

  // 3) Collapse long whitespace (avoid >4 spaces); safest is single space
  s = s.replace(/[ \u00A0]{2,}/g, " ");

  // 4) Trim edges
  s = s.trim();

  return s;
}

// Chunk after sanitization so limits are accurate for template
function packChunksForTemplate(safeText, limit = EFFECTIVE_LIMIT) {
  const text = String(safeText);
  const chunks = [];
  let current = "";

  // Prefer sentence boundaries, then words
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Za-z0-9])/);

  const pushOrStart = (piece) => {
    if (!current.length) {
      current = piece;
      return;
    }
    if (current.length + 1 + piece.length <= limit) {
      current += " " + piece;
    } else {
      chunks.push(current);
      current = piece;
    }
  };

  for (const p of parts) {
    if (p.length <= limit) {
      pushOrStart(p);
    } else {
      // split by words if sentence is still too long
      const words = p.split(/\s+/);
      for (const w of words) {
        if (!w) continue;
        if (!current.length) {
          current = w;
        } else if (current.length + 1 + w.length <= limit) {
          current += " " + w;
        } else {
          chunks.push(current);
          current = w;
        }
      }
    }
  }
  if (current.trim().length) chunks.push(current);
  return chunks;
}

function annotatePartsForTemplate(chunks) {
  if (chunks.length <= 1) return chunks;
  const n = chunks.length;
  return chunks.map((c, i) => `Part ${i + 1}/${n} — ` + c);
}

// ✅ Handle button replies from lecturers
async function handleLecturerButton(message) {
  const inboundId = message?.id;
  if (!inboundId) return;

  // 1) Anchor to the original template message that had the buttons
  const triggerId = message?.context?.id;
  if (!triggerId) return;

  // 2) Normalize reply EARLY (before idempotency check)
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

  const lower = reply.toLowerCase();

  // ✅ Exit early if this is a STUDENT button
  if (lower.includes("view schedule") || lower.includes("view_schedule")) {
    return; // Let handleStudentViewSchedule handle it
  }

  // 3) Fetch the lecture via the message sent earlier
  const lectureMessage = await LectureMessage.findOne({
    waMessageId: triggerId,
  });
  if (!lectureMessage) return; // Not a lecturer button, exit early

  // ✅ NOW do idempotency check (only for actual lecturer buttons)
  try {
    await ProcessedInbound.create({
      waMessageId: inboundId,
      from: message.from,
      type: "button_lecturer",
    });
  } catch (e) {
    if (e && e.code === 11000) {
      // duplicate inbound event -> already processed
      return;
    }
    throw e;
  }

  const lecture = await Lecture.findById(lectureMessage.lectureId).populate(
    "class"
  );
  if (!lecture) return;

  // 4) Map to desired status/action (explicit state transition)
  const desired =
    lower === "yes"
      ? "Confirmed"
      : lower === "no"
      ? "Cancelled"
      : lower.includes("reschedule")
      ? "Rescheduled"
      : null;

  // 5) Handle action-type branches first (add note / add document / no more)
  if (lower.includes("add note")) {
    await PendingAction.updateMany(
      { lecturerWhatsapp: lecture.lecturerWhatsapp, status: "pending" },
      { $set: { active: false } }
    );

    await PendingAction.findOneAndUpdate(
      { waMessageId: triggerId },
      {
        $set: {
          lecturerWhatsapp: lecture.lecturerWhatsapp,
          lecture: lecture._id,
          action: "add_note",
          status: "pending",
          active: true,
        },
      },
      { upsert: true, new: true }
    );

    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "✍️ Please type the note for this lecture.",
    });
    return;
  }

  if (lower.includes("add document")) {
    await PendingAction.updateMany(
      { lecturerWhatsapp: lecture.lecturerWhatsapp, status: "pending" },
      { $set: { active: false } }
    );

    await PendingAction.findOneAndUpdate(
      { waMessageId: triggerId },
      {
        $set: {
          lecturerWhatsapp: lecture.lecturerWhatsapp,
          lecture: lecture._id,
          action: "add_document",
          status: "pending",
          active: true,
        },
      },
      { upsert: true, new: true }
    );

    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "📄 Please upload the document file for this lecture.",
    });
    return;
  }

  if (lower.includes("no more")) {
    const pending = await PendingAction.findOne({
      waMessageId: triggerId,
      status: "pending",
    });
    if (pending) {
      pending.status = "closed";
      pending.active = false;
      await pending.save();
    }
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "👌 Got it. No extra notes or documents will be added.",
    });
    return;
  }

  // 6) Initial decision transitions (Confirmed/Cancelled/Rescheduled)
  let status = "";
  let notifyFn = null;

  if (desired) {
    if (lecture.status !== desired) {
      if (desired === "Confirmed") {
        lecture.status = "Confirmed";
        status = "Confirmed ✅";
        notifyFn = sendStudentClassConfirmed;

        await sendLecturerFollowUp({
          to: lecture.lecturerWhatsapp,
          lectureId: lecture._id,
        });
      } else if (desired === "Cancelled") {
        lecture.status = "Cancelled";
        status = "Cancelled ❌";
        notifyFn = sendStudentClassCancelled;

        await sendLecturerCancelNotePrompt({
          to: lecture.lecturerWhatsapp,
          lectureId: lecture._id,
        });
      } else if (desired === "Rescheduled") {
        lecture.status = "Rescheduled";
        status = "Rescheduled 📅";
      }
    } else {
      await sendWhatsAppText({
        to: lecture.lecturerWhatsapp,
        text: `ℹ️ Already ${lecture.status}.`,
      });
      return;
    }
  } else {
    return;
  }

  // 7) Save lecture updates
  await lecture.save();

  // 8) Notify students once per transition
  if (notifyFn) {
    const students = await User.find({ class: lecture.class._id }).select(
      "whatsappNumber fullName"
    );

    // Use smart functions that auto-detect sessions
    for (const student of students) {
      if (desired === "Confirmed") {
        await sendStudentClassConfirmedSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: formatTime(lecture.startTime),
          endTime: formatTime(lecture.endTime),
          location: lecture.location,
        });
      } else if (desired === "Cancelled") {
        await sendStudentClassCancelledSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: formatTime(lecture.startTime),
          endTime: formatTime(lecture.endTime),
          location: lecture.location,
        });
      }
    }
  }
}

// ✅ Handle reschedule submissions
// Place in your WhatsApp service module or near the handler
async function sendContributionFollowUp({
  lecture,
  kind /* "note"|"document" */,
}) {
  const to = lecture.lecturerWhatsapp;
  const lectureId = lecture._id;

  // Configure button set based on what was just contributed
  const btn =
    kind === "note"
      ? { id: `add_note_${lectureId}`, title: "➕ Add Note" }
      : { id: `add_document_${lectureId}`, title: "📄 Add Document" };

  const res = await sendWhatsAppText({
    to,
    text: "✅ Sent. Need to add anything else?",
    buttons: [btn, { id: `no_more_${lectureId}`, title: "❌ No" }],
  });

  const waMessageId = res?.messages?.[0]?.id;
  if (waMessageId) {
    // Map this interactive to the lecture for future context.id correlation
    await LectureMessage.create({
      lectureId,
      waMessageId,
      recipient: to,
      type: "contrib_followup",
    });

    // Create a pending action placeholder for button selection
    const exists = await PendingAction.findOne({ waMessageId });
    if (!exists) {
      await PendingAction.create({
        lecture: lectureId,
        action: "awaiting_choice",
        waMessageId,
        status: "pending",
        lecturerWhatsapp: to,
      });
    }
  }
}

// Prefer context.id -> active:true -> latest pending (no TTL checks)
async function resolvePendingForInbound({ message, waLocal }) {
  const ctxId = message?.context?.id;
  if (ctxId) {
    const byCtx = await PendingAction.findOne({
      waMessageId: ctxId,
      status: "pending",
    }).populate("lecture");
    if (byCtx) return byCtx; // deterministically anchored by interaction/reply
  }

  const focused = await PendingAction.findOne({
    lecturerWhatsapp: waLocal,
    status: "pending",
    active: true, // persistent focus
  })
    .sort({ updatedAt: -1 })
    .populate("lecture");
  if (focused) return focused;

  return await PendingAction.findOne({
    lecturerWhatsapp: waLocal,
    status: "pending",
  })
    .sort({ updatedAt: -1 })
    .populate("lecture");
}

// ✅ Handle lecturer contributions (idempotent + tolerant of awaiting_choice)
async function handleLecturerContribution(message) {
  let waId = message.from; // e.g., '2348032532333'
  const waMessageId = message.id; // inbound WAMID
  const type = message.type;
  let content = null;

  // convert incoming number to local 11-digit format
  if (waId && waId.startsWith("234") && waId.length === 13) {
    waId = "0" + waId.slice(3); // '2348032532333' => '08032532333'
  }

  // Resolve pending with context-aware lookup first
  const pending = await resolvePendingForInbound({ message, waLocal: waId });
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

  // Normalize awaiting_* actions into concrete actions based on inbound type
  let effectiveAction = pending.action;

  if (effectiveAction === "awaiting_choice") {
    if (type === "text") {
      effectiveAction = "add_note";
      pending.action = "add_note";
      await pending.save();
    } else if (type === "document") {
      effectiveAction = "add_document";
      pending.action = "add_document";
      await pending.save();
    } else {
      await sendWhatsAppText({
        to: lecture.lecturerWhatsapp,
        text: "ℹ️ Please send a text note or upload a document.",
      });
      return;
    }
  }

  if (effectiveAction === "awaiting_cancel_choice") {
    if (type === "text") {
      effectiveAction = "add_note";
      pending.action = "add_note";
      await pending.save();
    } else if (type === "document") {
      await sendWhatsAppText({
        to: lecture.lecturerWhatsapp,
        text: "ℹ️ For cancelled classes, please send a text note (documents aren’t accepted).",
      });
      return;
    } else {
      await sendWhatsAppText({
        to: lecture.lecturerWhatsapp,
        text: "ℹ️ Please send the cancellation note as text.",
      });
      return;
    }
  }

  let inserted = false;

  if (effectiveAction === "add_note" && type === "text") {
    // Duplicate detection (unchanged)
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
      await sendWhatsAppText({ to: lecture.lecturerWhatsapp, text: "✅ Sent" });
      return;
    }

    // Persist before fan-out
    await lecture.save();
    await pending.save();

    // ✅ NEW APPROACH: Check session mix and send accordingly
    const students = await User.find({ class: lecture.class }).select(
      "whatsappNumber fullName"
    );

    let sessionCount = 0;
    let templateCount = 0;

    // Check how many students have sessions
    for (const student of students) {
      const hasSession = await hasActiveSession(student.whatsappNumber);
      if (hasSession) {
        sessionCount++;
      } else {
        templateCount++;
      }
    }

    console.log(
      `📊 Session split: ${sessionCount} with session, ${templateCount} without`
    );

    if (templateCount > 0) {
      // Some students need templates - chunk for them
      const cleaned = sanitizeForWhatsAppTemplate(content);
      const chunks = annotatePartsForTemplate(
        packChunksForTemplate(cleaned, EFFECTIVE_LIMIT)
      );

      // Send each chunk
      for (const part of chunks) {
        await notifyStudentsOfContribution(lecture, "add_note", part);
      }
    } else {
      // All students have sessions - send full note once
      await notifyStudentsOfContribution(lecture, "add_note", content);
    }

    // Send interactive follow-up anchored to this lecture
    await sendContributionFollowUp({ lecture, kind: "note" });
    return; // done with text path
  } else if (effectiveAction === "add_document" && type === "document") {
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

    if (inserted) {
      await lecture.save();
      pending.active = false; // focus consumed on completion
      await pending.save();
      await notifyStudentsOfContribution(lecture, "add_document", content);

      // Send interactive follow-up anchored to this lecture
      await sendContributionFollowUp({ lecture, kind: "document" });
    } else {
      console.log(
        "ℹ️ No changes persisted due to duplication; notifying lecturer only."
      );
      await sendWhatsAppText({ to: lecture.lecturerWhatsapp, text: "✅ Sent" });
    }
    return;
  } else {
    console.log(`⚠️ Action/type mismatch: ${effectiveAction} vs ${type}`);
    return;
  }
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
    await sendStudentClassRescheduledSmart({
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

async function handleStudentViewSchedule(message) {
  // Extract button reply
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

  const lower = (reply || "").toLowerCase();

  // Only handle "view schedule" clicks
  if (!lower.includes("view schedule") && !lower.includes("view_schedule")) {
    return; // Not our button, skip silently
  }

  // Idempotency check
  const inboundId = message.id;
  try {
    await ProcessedInbound.create({
      waMessageId: inboundId,
      from: message.from,
      type: "button_view_schedule",
    });
  } catch (e) {
    if (e && e.code === 11000) {
      console.log(`🔁 Duplicate view schedule ${inboundId}, skipping.`);
      return;
    }
    throw e;
  }

  // Get student info
  const local = toLocalMsisdn(message.from);
  const student = await User.findOne({ whatsappNumber: local }).populate(
    "class"
  );

  if (!student || !student.class) {
    await sendWhatsAppText({
      to: local,
      text: "⚠️ Could not find your class information. Please contact support.",
    });
    return;
  }

  // Fetch today's lectures
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

  // Build full schedule message
  let scheduleText = `📚 Hello ${
    student.fullName
  }, here's your schedule for ${formatLagosDate(new Date())}:\n\n`;

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

    scheduleText += `${i + 1}. ${lec.course} by ${
      lec.lecturer
    } (${start}-${end}) - ${statusText}\n`;
  });

  // Send as FREE message (session already open from button click)
  await sendWhatsAppText({
    to: student.whatsappNumber,
    text: scheduleText,
    buttons: [
      {
        id: "Got_it",
        title: "Got it",
      },
    ],
  });

  console.log(`✅ Full schedule sent to ${student.fullName}`);
}

module.exports = {
  handleLecturerButton,
  handleLecturerReschedule,
  handleLecturerContribution,
  handleStudentKeywordSummary,
  handleClassRepBroadcast,
  handleStudentViewSchedule,
};
