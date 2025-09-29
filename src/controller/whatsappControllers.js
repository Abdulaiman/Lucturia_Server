// whatsappHandlers.js

const LectureMessage = require("../model/lectureMessageModel");
const Lecture = require("../model/lectureModel");
const PendingAction = require("../model/pendingActionModel");
const User = require("../model/userModel");
const {
  sendStudentClassConfirmed,
  sendStudentClassCancelled,
  sendStudentClassRescheduled,
  sendLecturerFollowUp,
  sendWhatsAppText,
  notifyStudentsOfContribution,
} = require("../services/whatsapp");
const { getFirstName, formatTime } = require("../../utils/helpers");

// ✅ Handle button replies from lecturers
async function handleLecturerButton(message) {
  // --- normalize reply text ---
  let reply = "";
  const waMessageId = message.context?.id; // the triggering message id

  if (message.type === "button" && message.button) {
    // Plain button
    reply = message.button.text || message.button.payload;
  } else if (
    message.type === "interactive" &&
    message.interactive?.type === "button_reply"
  ) {
    // Interactive button reply
    reply =
      message.interactive.button_reply.title ||
      message.interactive.button_reply.id;
  }

  if (!reply) {
    console.log("⚠️ Could not extract button reply from message:", message);
    return;
  }

  console.log(`👉 Lecturer button reply detected: ${reply}`);

  // --- find the lecture from the triggering message ---
  const lectureMessage = await LectureMessage.findOne({ waMessageId });
  if (!lectureMessage) return;

  const lecture = await Lecture.findById(lectureMessage.lectureId).populate(
    "class"
  );
  if (!lecture) return;

  console.log(`Lecturer responded to lecture ${lecture._id}: ${reply}`);

  let status = "";
  let notifyFn = null;

  // --- handle initial confirmation buttons ---
  if (reply.toLowerCase() === "yes") {
    lecture.status = "Confirmed";
    status = "Confirmed ✅";
    notifyFn = sendStudentClassConfirmed;

    // send follow-up (creates PendingAction)
    await sendLecturerFollowUp({
      to: lecture.lecturerWhatsapp,
      lectureId: lectureMessage.lectureId,
    });
  } else if (reply.toLowerCase() === "no") {
    lecture.status = "Cancelled";
    status = "Cancelled ❌";
    notifyFn = sendStudentClassCancelled;
  } else if (reply.toLowerCase().includes("reschedule")) {
    lecture.status = "Rescheduled";
    status = "Rescheduled 📅";
    console.log("Lecturer initiated reschedule flow");
  }

  // --- handle follow-up buttons (Add Note / Add Document / No More) ---
  else if (reply.toLowerCase().includes("add note")) {
    console.log("inside add note");
    let pending = await PendingAction.findOne({
      waMessageId,
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
        waMessageId,
        status: "pending",
      });
    }

    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "✍️ Please type the note you’d like to add for this lecture.",
    });
    return;
  } else if (reply.toLowerCase().includes("add document")) {
    console.log("inside add document");
    let pending = await PendingAction.findOne({
      waMessageId,
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
        waMessageId,
        status: "pending",
      });
    }
    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "📄 Please upload the document file for this lecture.",
    });
    return;
  } else if (
    reply.toLowerCase().includes("no more") ||
    reply.toLowerCase().includes("no")
  ) {
    const pending = await PendingAction.findOne({
      waMessageId,
      status: "pending",
    });
    if (pending) {
      await pending.save();
    }

    await sendWhatsAppText({
      to: lecture.lecturerWhatsapp,
      text: "👌 Got it. No extra notes or documents will be added.",
    });
    return;
  }

  // --- persist changes for confirm/cancel/reschedule ---
  await lecture.save();

  // --- notify students if applicable ---
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

    console.log(`📢 Notified ${students.length} students`);
  }
}

async function handleLecturerContribution(message) {
  let waId = message.from; // e.g., '2348032532333'
  const waMessageId = message.id;
  let content = null;
  const type = message.type;

  // convert incoming number to local 11-digit format
  if (waId.startsWith("234") && waId.length === 13) {
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

  // capture the content
  if (type === "text") {
    content = message.text.body;
    console.log(`📝 Lecturer note captured: ${content}`);
  } else if (type === "document") {
    content = {
      waId: message.document.id, // ✅ renamed for consistency
      fileName: message.document.filename,
      mimeType: message.document.mime_type,
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

  if (pending.action === "add_note" && type === "text") {
    lecture.notes = lecture.notes || [];
    lecture.notes.push({
      text: content,
      addedBy: waId,
      createdAt: new Date(),
    });
  } else if (pending.action === "add_document" && type === "document") {
    lecture.documents = lecture.documents || [];
    lecture.documents.push(content); // ✅ already structured with waId/fileName/mimeType
  }

  await lecture.save();

  await pending.save();

  // notify students with the *same content shape* you just saved
  await notifyStudentsOfContribution(lecture, pending.action, content);

  // confirm to lecturer
  await sendWhatsAppText({
    to: lecture.lecturerWhatsapp,
    text: "✅ Sent",
  });
}

// -----------------
// Handle reschedule submissions (unchanged)
// -----------------

// ✅ Handle reschedule submissions
async function handleLecturerReschedule(message) {
  const resData = JSON.parse(message.interactive.nfm_reply.response_json);

  const waMessageId = message.context?.id;
  const lectureMessage = await LectureMessage.findOne({ waMessageId });
  if (!lectureMessage) return;

  const lecture = await Lecture.findById(lectureMessage.lectureId).populate(
    "class"
  );
  if (!lecture) return;

  lecture.status = "Rescheduled";
  lecture.startTime = new Date(
    `${resData.screen_0_New_Date_0}T${
      resData.screen_0_Class_Starts_1.split("_")[1]
    }`
  );
  lecture.endTime = new Date(
    `${resData.screen_0_New_Date_0}T${
      resData.screen_0_Class_Ends_2.split("_")[1]
    }`
  );

  await lecture.save();

  console.log(
    `📅 Lecture rescheduled: ${lecture.startTime} - ${lecture.endTime}`
  );

  // notify students
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
}

module.exports = {
  handleLecturerButton,
  handleLecturerReschedule,
  handleLecturerContribution,
};
