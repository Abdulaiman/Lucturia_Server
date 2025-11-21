// models/userModel.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    regNumber: { type: String },
    whatsappNumber: {
      type: String,
      unique: true,
      match: [/^\d{10,15}$/, "Please provide a valid phone number"],
    },
    role: {
      type: String,
      enum: ["student", "classrep", "admin"],
      default: "student",
    },
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
    },
    onboardingStep: {
      type: String,
      enum: ["NONE", "FULL_NAME", "REG_NUMBER", "COMPLETE"],
      default: "NONE",
    },
    lastMessageTime: { type: Number, default: null }, // ✅ NEW FIELD
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
module.exports = User;
