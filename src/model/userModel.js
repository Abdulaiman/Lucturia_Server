// models/userModel.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    regNumber: { type: String, required: true, unique: true },
    whatsappNumber: {
      type: String,
      required: true,
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
    lastMessageTime: { type: Number, default: null }, // ✅ NEW FIELD
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
module.exports = User;
