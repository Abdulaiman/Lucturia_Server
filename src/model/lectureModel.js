// models/Lecture.js
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    fileName: String, // WhatsApp filename
    mimeType: String, // application/pdf, pptx, etc
    waId: String, // WhatsApp media ID (to fetch/download later)
    sha256: String, // optional hash
    url: String, // if you later fetch and store
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    addedBy: { type: String }, // lecturer number
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const lectureSchema = new mongoose.Schema(
  {
    course: { type: String, required: true },
    lecturer: { type: String, required: true },
    lecturerWhatsapp: { type: String },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: [
        "Confirmed",
        "Cancelled",
        "Rescheduled",
        "Upcoming",
        "Ongoing",
        "Completed",
        "Pending",
      ],
      default: "Pending",
    },
    location: { type: String },
    description: { type: String },
    documents: [documentSchema],
    notes: [noteSchema], // ✅ fixed: structured notes
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lecture", lectureSchema);
