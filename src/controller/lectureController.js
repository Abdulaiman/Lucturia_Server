// controllers/lectureController.js
const Lecture = require("../model/lectureModel");
const Class = require("../model/classModel");
const catchAsync = require("../../utils/catch-async"); // adapt to your helper
const AppError = require("../../utils/app-error");
const { sendLecturerWelcomeTemplate } = require("../services/whatsapp");

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
  const lecture = await Lecture.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!lecture) return next(new AppError("Lecture not found", 404));
  res.status(200).json({ status: "success", data: lecture });
});

// Delete lecture
exports.deleteLecture = catchAsync(async (req, res, next) => {
  const lecture = await Lecture.findByIdAndDelete(req.params.id);
  if (!lecture) return next(new AppError("Lecture not found", 404));
  res.status(204).json({ status: "success", data: null });
});
