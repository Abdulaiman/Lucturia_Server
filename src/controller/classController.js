// controllers/classController.js
const Class = require("../model/classModel");
const User = require("../model/userModel");
const AppError = require("../../utils/app-error");
const catchAsync = require("../../utils/catch-async");
const { sendWelcomeTemplate } = require("../services/whatsapp");

// Create a new class
// controllers/classController.js
exports.createClass = catchAsync(async (req, res, next) => {
  const {
    title,
    description,
    institution,
    year,
    level,
    classRepNumber,
    nickname,
  } = req.body;

  // validate classRepNumber exists in platform
  let classRep = null;
  if (classRepNumber) {
    classRep = await User.findOne({ whatsappNumber: classRepNumber });
    if (!classRep)
      return next(new AppError("Class rep not found on the platform", 404));
  }

  const newClass = await Class.create({
    title,
    description,
    institution,
    year,
    level,
    nickname,
    classRep: classRep?._id,
  });

  // update rep role
  if (classRep) {
    classRep.role = "classrep";
    classRep.class = newClass._id;
    await classRep.save();
  }

  res.status(201).json({ status: "success", data: newClass });
});

// Get all classes
exports.getAllClasses = catchAsync(async (req, res, next) => {
  const classes = await Class.find().populate(
    "classRep",
    "fullName regNumber whatsappNumber"
  );
  res
    .status(200)
    .json({ status: "success", results: classes.length, data: classes });
});

// Get class by ID (with members queried separately)
exports.getClass = catchAsync(async (req, res, next) => {
  const myClass = await Class.findById(req.params.id).populate(
    "classRep",
    "fullName regNumber whatsappNumber"
  );

  if (!myClass) return next(new AppError("Class not found", 404));

  // 🔎 instead of storing an array, query users who belong to this class
  const students = await User.find({ class: myClass._id }).select(
    "fullName regNumber whatsappNumber"
  );

  res.status(200).json({
    status: "success",
    data: {
      ...myClass.toObject(),
      students,
    },
  });
});

// Student joins a class

exports.joinClass = catchAsync(async (req, res, next) => {
  const { classId, userId } = req.body;

  const myClass = await Class.findById(classId);
  if (!myClass) return next(new AppError("Class not found", 404));

  const user = await User.findById(userId);
  if (!user) return next(new AppError("User not found", 404));

  // If user already in another class
  if (user.class && user.class.toString() !== classId) {
    return next(new AppError("User already belongs to another class", 400));
  }

  user.class = classId;
  user.onboardingStep = "COMPLETE";
  await user.save();
  console.log(user);
  console.log(myClass);
  // ✅ Send WhatsApp welcome template after joining
  try {
    await sendWelcomeTemplate(
      user.whatsappNumber,
      user.fullName,
      myClass.title
    );
  } catch (err) {
    console.error(
      "❌ Failed to send WhatsApp welcome:",
      err.response?.data || err.message
    );
  }

  res.status(200).json({
    status: "success",
    message: "Joined class successfully",
    data: { class: myClass, user },
  });
});

// Remove student (just clear their class ref)
exports.removeStudent = catchAsync(async (req, res, next) => {
  const { userId } = req.body;

  const user = await User.findById(userId);
  if (!user) return next(new AppError("User not found", 404));

  user.class = undefined;
  await user.save();

  res
    .status(200)
    .json({ status: "success", message: "Student removed from class" });
});

exports.findUserByWhatsapp = catchAsync(async (req, res, next) => {
  const { whatsappNumber } = req.body;

  if (!whatsappNumber)
    return next(new AppError("WhatsApp number is required", 400));

  const user = await User.findOne({ whatsappNumber }).select(
    "fullName regNumber whatsappNumber role"
  );

  if (!user) {
    return next(new AppError("No user found with this WhatsApp number", 404));
  }

  res.status(200).json({
    status: "success",
    data: user,
  });
});

// ✅ Get all members of a class
exports.getClassMembers = catchAsync(async (req, res, next) => {
  const { classId } = req.params;

  // 1. Check if class exists
  const classObj = await Class.findById(classId).populate(
    "classRep",
    "fullName regNumber whatsappNumber"
  );
  if (!classObj) return next(new AppError("Class not found", 404));

  // 2. Fetch all users with this class assigned
  const members = await User.find({ class: classId }).select(
    "fullName regNumber whatsappNumber role"
  );

  res.status(200).json({
    status: "success",
    data: {
      class: {
        _id: classObj._id,
        title: classObj.title,
        institution: classObj.institution,
        year: classObj.year,
        level: classObj.level,
        classRep: classObj.classRep,
      },
      members,
    },
  });
});
