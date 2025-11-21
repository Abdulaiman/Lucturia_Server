// controllers/lectureController.js
const Lecture = require("../model/lectureModel");
const Class = require("../model/classModel");
const User = require("../model/userModel");
const catchAsync = require("../../utils/catch-async"); // adapt to your helper
const AppError = require("../../utils/app-error");
const {
  sendLecturerWelcomeTemplate,
  sendWhatsAppMessage,
  sendStudentClassConfirmedSmart,
  sendStudentClassCancelledSmart,
  sendStudentClassRescheduledSmart,
} = require("../services/whatsapp");
const { getFirstName } = require("../../utils/helpers");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  sendWhatsAppText,
  sendLecturerReminderTemplate,
} = require("../services/whatsapp");

function formatLagosTime(date) {
  return dayjs(date).tz("Africa/Lagos").format("HH:mm");
}
exports.createLecture = catchAsync(async (req, res, next) => {
  const {
    course,
    lecturer,
    lecturerWhatsapp, // ✅ lecturer WhatsApp number
    startTime,
    endTime,
    location,
    description,
    documents,
    classId,
    repeat,
    weeks,
  } = req.body;

  // Validate required fields
  if (!classId) return next(new AppError("classId (class) is required", 400));
  if (!course || !lecturer || !startTime || !endTime) {
    return next(
      new AppError("course, lecturer, startTime and endTime are required", 400)
    );
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (end <= start) {
    return next(new AppError("endTime must be after startTime", 400));
  }

  const occurrences = Math.max(1, repeat ? parseInt(weeks || 1, 10) : 1);
  const lectures = [];

  // 🔹 Fetch class so we can use its title later
  const classDoc = await Class.findById(classId);
  if (!classDoc) {
    return next(new AppError("Class not found", 404));
  }

  // Create lecture occurrences
  for (let i = 0; i < occurrences; i++) {
    const newStart = new Date(start);
    newStart.setDate(start.getDate() + i * 7);

    const newEnd = new Date(end);
    newEnd.setDate(end.getDate() + i * 7);

    const lecture = await Lecture.create({
      course,
      lecturer,
      lecturerWhatsapp,
      startTime: newStart,
      endTime: newEnd,
      location,
      description,
      documents,
      class: classId,
    });

    lectures.push(lecture);
  }

  if (lecturerWhatsapp && lectures.length > 0) {
    const createdIds = lectures.map((l) => l._id);
    const alreadyExists = await Lecture.exists({
      lecturerWhatsapp,
      _id: { $nin: createdIds }, // exclude the whole current batch
    });

    if (!alreadyExists) {
      try {
        await sendLecturerWelcomeTemplate(
          lecturerWhatsapp,
          lecturer, // 👈 goes into {{name}}
          classDoc.title // 👈 use class title instead of course
        );
      } catch (err) {
        console.error("⚠️ Failed to send lecturer welcome:", err.message);
        // do not block lecture creation if message fails
      }
    }
  }

  res.status(201).json({
    status: "success",
    data: lectures,
  });
});

// Get all lectures (admin)
exports.getAllLectures = catchAsync(async (req, res, next) => {
  const lectures = await Lecture.find().populate(
    "class",
    "title institution year nickname"
  );
  res
    .status(200)
    .json({ status: "success", results: lectures.length, data: lectures });
});

// Get lectures by class

exports.getLecturesByClass = catchAsync(async (req, res, next) => {
  const { classId } = req.params;
  const { date } = req.query;

  if (!classId) return next(new AppError("classId is required", 400));

  let query = { class: classId };

  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fix: match lectures that overlap the given day
    query = {
      ...query,
      $or: [
        {
          startTime: { $gte: startOfDay, $lte: endOfDay }, // starts within the day
        },
        {
          endTime: { $gte: startOfDay, $lte: endOfDay }, // ends within the day
        },
        {
          startTime: { $lte: startOfDay },
          endTime: { $gte: endOfDay }, // spans the whole day
        },
      ],
    };
  }

  const lectures = await Lecture.find(query).sort({ startTime: 1 });

  res.status(200).json({
    status: "success",
    results: lectures.length,
    data: lectures,
  });
});

// Get single lecture
exports.getLectureById = catchAsync(async (req, res, next) => {
  const lecture = await Lecture.findById(req.params.id);
  if (!lecture) return next(new AppError("Lecture not found", 404));
  res.status(200).json({ status: "success", data: lecture });
});

// Update lecture
exports.updateLecture = catchAsync(async (req, res, next) => {
  const lecture = await Lecture.findById(req.params.id);
  if (!lecture) return next(new AppError("Lecture not found", 404));

  // Store old values
  const oldStart = new Date(lecture.startTime);
  const oldEnd = new Date(lecture.endTime);
  const oldLocation = lecture.location;
  const oldStatus = lecture.status;
  const oldCourse = lecture.course;
  const oldLecturer = lecture.lecturer;

  // Apply incoming changes
  Object.assign(lecture, req.body);

  const newStart = new Date(lecture.startTime);
  const newEnd = new Date(lecture.endTime);
  const newLocation = lecture.location;
  const newStatus = lecture.status;
  const newCourse = lecture.course;
  const newLecturer = lecture.lecturer;

  // Check if only lecturer or course changed
  const onlyCourseOrLecturerChanged =
    (oldCourse !== newCourse || oldLecturer !== newLecturer) &&
    oldStart.getTime() === newStart.getTime() &&
    oldEnd.getTime() === newEnd.getTime() &&
    oldLocation === newLocation &&
    oldStatus === newStatus;

  // Save lecture first
  await lecture.save();

  // If only lecturer/course changed, skip notifications
  if (onlyCourseOrLecturerChanged) {
    return res.status(200).json({
      status: "success",
      data: lecture,
      message:
        "Lecture updated. No notifications sent (only course or lecturer changed).",
    });
  }

  // Otherwise, handle date/time/location/status changes
  let effectiveStatus = newStatus;

  const oldDate = oldStart.toISOString().split("T")[0];
  const newDate = newStart.toISOString().split("T")[0];
  const oldStartTime = oldStart.toTimeString().slice(0, 5);
  const newStartTime = newStart.toTimeString().slice(0, 5);
  const oldEndTime = oldEnd.toTimeString().slice(0, 5);
  const newEndTime = newEnd.toTimeString().slice(0, 5);

  const dateChanged = oldDate !== newDate;
  const timeChanged =
    oldStartTime !== newStartTime || oldEndTime !== newEndTime;

  if (dateChanged || timeChanged) effectiveStatus = "Rescheduled";
  else if (oldStatus !== newStatus) effectiveStatus = newStatus;
  else if (oldLocation !== newLocation) effectiveStatus = newStatus;
  else {
    return res.status(200).json({
      status: "success",
      data: lecture,
      message: "No significant changes detected, no notifications sent.",
    });
  }

  lecture.status = effectiveStatus;
  await lecture.save();

  // Notify students
  const students = await User.find({ class: lecture.class }).select(
    "whatsappNumber fullName"
  );

  const startTimeStr = newStart.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  });
  const endTimeStr = newEnd.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  });
  const lectureDate = newStart.toLocaleDateString();

  for (const student of students) {
    try {
      if (effectiveStatus === "Cancelled") {
        await sendStudentClassCancelledSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: lecture.location,
        });
      } else if (effectiveStatus === "Rescheduled") {
        await sendStudentClassRescheduledSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          course: lecture.course,
          lecturerName: lecture.lecturer,
          newDate: lectureDate,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: lecture.location,
          note: "Rescheduled by your class rep.",
        });
      } else if (oldStatus !== "Confirmed" && newStatus === "Confirmed") {
        sendStudentClassConfirmedSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          status: "Confirmed",
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: lecture.location,
        });
      } else if (oldLocation !== newLocation) {
        await sendStudentClassConfirmedSmart({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          status: lecture.status,
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: lecture.location,
        });
      }
    } catch (err) {
      console.error(
        `❌ Failed to notify ${student.fullName} (${student.whatsappNumber}):`,
        err.message
      );
    }
  }

  res.status(200).json({
    status: "success",
    data: lecture,
  });
});

// Delete lecture
exports.deleteLecture = catchAsync(async (req, res, next) => {
  const lecture = await Lecture.findByIdAndDelete(req.params.id);
  if (!lecture) return next(new AppError("Lecture not found", 404));
  res.status(204).json({ status: "success", data: null });
});

exports.remindLecturer = catchAsync(async (req, res, next) => {
  const lectureId = req.params.id;
  const mode = "template";

  const lecture = await Lecture.findById(lectureId);
  if (!lecture) return next(new AppError("Lecture not found", 404));

  // Enforce one reminder per lecture
  if (lecture.reminder?.sent) {
    return next(new AppError("Reminder already sent for this lecture", 409));
  }

  // Guard: only allow for lectures scheduled today (Africa/Lagos)
  const isToday = dayjs(lecture.startTime)
    .tz("Africa/Lagos")
    .isSame(dayjs().tz("Africa/Lagos"), "day");
  if (!isToday) {
    return next(
      new AppError("Reminders can only be sent for today's lectures", 400)
    );
  }

  const classDoc = await Class.findById(lecture.class);
  if (!classDoc) return next(new AppError("Class not found for lecture", 404));

  const lecturerWhatsapp = lecture.lecturerWhatsapp;
  if (!lecturerWhatsapp)
    return next(new AppError("Lecturer WhatsApp not set", 400));

  const startTime = formatLagosTime(lecture.startTime);
  const endTime = formatLagosTime(lecture.endTime);
  const classTitle = classDoc.title;

  let delivery = null;

  // Try session message if explicitly requested
  if (mode === "session") {
    try {
      await sendWhatsAppText({
        to: lecturerWhatsapp,
        text: `⏰ Reminder: students for ${lecture.course} are awaiting your response. Please confirm or reschedule.`,
        buttons: [
          { id: "yes", title: "✅ Yes" },
          { id: "no", title: "❌ No" },
          { id: "reschedule", title: "📅 Reschedule" },
        ],
      });
      delivery = "session";
    } catch (e) {
      // fall back to template below
    }
  }

  // If session not used or failed, send template (outside window)
  if (!delivery && (mode === "template" || mode === "auto")) {
    await sendLecturerReminderTemplate({
      to: lecturerWhatsapp,
      lecturerName: lecture.lecturer,
      course: lecture.course,
      classTitle,
      startTime,
      endTime,
      location: lecture.location,
    });
    delivery = "template";
  }

  if (!delivery) {
    return next(
      new AppError(
        "Failed to send reminder (session blocked and template disabled)",
        500
      )
    );
  }

  // Mark reminder as sent after successful delivery
  lecture.reminder = {
    sent: true,
    sentAt: new Date(),
    sentVia: delivery,
  };
  await lecture.save();

  return res.status(200).json({
    status: "success",
    data: { lectureId, delivery },
  });
});

// controllers/lectureController.js
// controllers/lectureController.js
exports.announceOngoing = catchAsync(async (req, res, next) => {
  const lectureId = req.params.id;

  // Verify lecture exists and is today in Africa/Lagos
  const nowLagos = dayjs().tz("Africa/Lagos");
  let lecture = await Lecture.findById(lectureId);
  if (!lecture) return next(new AppError("Lecture not found", 404));

  const isToday = dayjs(lecture.startTime)
    .tz("Africa/Lagos")
    .isSame(nowLagos, "day");
  if (!isToday)
    return next(new AppError("Announcements only for today's lectures", 400));

  // Authorization: user must belong to this class
  // if (!req.user || String(req.user.class) !== String(lecture.class)) {
  //   return next(new AppError("Not allowed for this class", 403));
  // }

  // Atomic “first click wins”
  lecture = await Lecture.findOneAndUpdate(
    { _id: lectureId, "announcement.sent": { $ne: true } },
    {
      $set: {
        "announcement.sent": true,
        "announcement.sentAt": new Date(),
      },
    },
    { new: true }
  );
  if (!lecture)
    return next(
      new AppError("Announcement already sent for this lecture", 409)
    );

  // Build Lagos-local text + single OK button
  const startTime = dayjs(lecture.startTime).tz("Africa/Lagos").format("HH:mm");
  const endTime = dayjs(lecture.endTime).tz("Africa/Lagos").format("HH:mm");
  const msg =
    `📣 Class update: ${lecture.course} with ${lecture.lecturer} is now *ONGOING*` +
    `${
      lecture.location ? ` at ${lecture.location}` : ""
    } (${startTime}–${endTime}).`; // <= 1024 chars
  const buttons = [{ id: `ok_${lecture._id}`, title: "OK" }]; // <= 3 buttons, <= 20 chars each

  const students = await User.find({ class: lecture.class }).select(
    "whatsappNumber fullName"
  );

  // Fan-out using session messages (interactive with OK; fallback to plain text if interactive fails)
  const jobs = students.map(async (s) => {
    try {
      return await sendWhatsAppText({
        to: s.whatsappNumber,
        text: msg,
        buttons,
      });
    } catch {
      // Plain text fallback (still requires session window)
      return await sendWhatsAppMessage({ to: s.whatsappNumber, text: msg });
    }
  });

  const results = await Promise.allSettled(jobs);
  const delivered = results.filter((r) => r.status === "fulfilled").length;

  return res.status(200).json({
    status: "success",
    data: { delivered, total: students.length },
  });
});
