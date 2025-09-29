// controllers/lectureController.js
const Lecture = require("../model/lectureModel");
const Class = require("../model/classModel");
const User = require("../model/userModel");
const catchAsync = require("../../utils/catch-async"); // adapt to your helper
const AppError = require("../../utils/app-error");
const {
  sendLecturerWelcomeTemplate,
  sendStudentClassCancelled,
  sendStudentClassRescheduled,
  sendStudentClassConfirmed,
} = require("../services/whatsapp");
const { getFirstName } = require("../../utils/helpers");

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

  // ✅ Send lecturer welcome template only once per lecturer
  if (lecturerWhatsapp) {
    const alreadyExists = await Lecture.exists({
      lecturerWhatsapp,
      _id: { $ne: lectures[0]._id }, // exclude the one we just created
    });

    if (!alreadyExists) {
      try {
        await sendLecturerWelcomeTemplate(
          lecturerWhatsapp,
          lecturer, // 👈 goes into {{name}}
          classDoc.title // 👈 now using class title instead of course
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

  const startTimeStr = newStart.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTimeStr = newEnd.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const lectureDate = newStart.toLocaleDateString();

  for (const student of students) {
    try {
      if (effectiveStatus === "Cancelled") {
        await sendStudentClassCancelled({
          to: student.whatsappNumber,
          studentName: getFirstName(student.fullName),
          course: lecture.course,
          lecturerName: lecture.lecturer,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: lecture.location,
        });
      } else if (effectiveStatus === "Rescheduled") {
        await sendStudentClassRescheduled({
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
        await sendStudentClassConfirmed({
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
        await sendStudentClassConfirmed({
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
