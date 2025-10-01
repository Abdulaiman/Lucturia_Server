// model/lectureModel.js (extend your existing schema)
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    fileName: String,
    mimeType: String,
    waId: String,
    sha256: String,
    url: String,
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    addedBy: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reminderSchema = new mongoose.Schema(
  {
    sent: { type: Boolean, default: false },
    sentAt: { type: Date },
    sentVia: {
      type: String,
      enum: ["session", "template", null],
      default: "template",
    },
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
    notes: [noteSchema],
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    reminder: { type: reminderSchema, default: () => ({}) }, // <-- NEW
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lecture", lectureSchema);
