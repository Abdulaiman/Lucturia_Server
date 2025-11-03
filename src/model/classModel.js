// models/classModel.js
const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    institution: { type: String, trim: true },
    nickname: { type: String, trim: true },
    year: { type: String, trim: true }, // e.g. "2021"
    level: { type: String, trim: true }, // e.g. "400L"
    classRep: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // 🔹 New: Controls whether lecturers are notified for this class
    notifyLecturers: {
      type: Boolean,
      default: false, // keep current behavior for existing classes
    },
  },
  { timestamps: true }
);

const Class = mongoose.model("Class", classSchema);
module.exports = Class;
