const AppError = require("../../utils/app-error");
const catchAsync = require("../../utils/catch-async");
const User = require("../model/userModel");

const crypto = require("crypto");
const {
  sendWhatsAppTemplate,
  sendAuthOtpTemplate,
} = require("../services/whatsapp");

// In-memory store for demo, replace with DB in production
const otpStore = {};

// Signup controller
exports.signup = catchAsync(async (req, res, next) => {
  const { fullName, regNumber, whatsappNumber } = req.body;

  if (!fullName || !regNumber || !whatsappNumber) {
    return next(new AppError("All fields are required", 400));
  }

  const user = await User.create({ fullName, regNumber, whatsappNumber });

  res.status(201).json({
    status: "success",
    data: {
      user,
    },
  });
});

/**
 * Generate and send OTP
 */
exports.sendOtp = catchAsync(async (req, res, next) => {
  const { whatsappNumber } = req.body;

  if (!whatsappNumber) {
    return next(new AppError("Whatsapp number required", 400));
  }

  // 1️⃣ Find user by whatsappNumber
  const user = await User.findOne({ whatsappNumber });
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // 2️⃣ Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();

  // 3️⃣ Store OTP temporarily (5 min expiry)
  otpStore[whatsappNumber] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  // 4️⃣ Send OTP via WhatsApp **template**
  // Template name must match your approved WhatsApp template
  await sendAuthOtpTemplate(whatsappNumber, "otp_code", otp);

  res.status(200).json({
    status: "success",
    message: "OTP sent successfully",
  });
});

exports.verifyOtp = catchAsync(async (req, res, next) => {
  const { whatsappNumber, otp } = req.body;

  if (!whatsappNumber || !otp) {
    return next(new AppError("Whatsapp number and OTP are required", 400));
  }

  const record = otpStore[whatsappNumber];
  if (!record)
    return next(new AppError("No OTP found. Please request a new one.", 400));
  if (record.expires < Date.now())
    return next(new AppError("OTP expired. Please request a new one.", 400));
  if (record.otp !== otp)
    return next(new AppError("Invalid OTP. Try again.", 400));

  // ✅ success → fetch user
  const user = await User.findOne({ whatsappNumber });
  if (!user) return next(new AppError("User not found", 404));

  delete otpStore[whatsappNumber]; // clear OTP once used

  res.status(200).json({
    status: "success",
    message: "OTP verified. Login successful",
    user, // 👈 send back full user
  });
});
