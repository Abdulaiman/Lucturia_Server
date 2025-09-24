const express = require("express");
const { signup, sendOtp, verifyOtp } = require("../controller/authController");

const router = express.Router();

// Signup route
router.post("/signup", signup);
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

module.exports = router;
