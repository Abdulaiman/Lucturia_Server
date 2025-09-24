// models/Lecture.js
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    name: String,
    href: String,
  },
  { _id: false }
);

// models/Lecture.js
const lectureSchema = new mongoose.Schema(
  {
    course: { type: String, required: true },
    lecturer: { type: String, required: true },
    lecturerWhatsapp: { type: String }, // ✅ new internal field
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
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lecture", lectureSchema);
