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
const announcementSchema = new mongoose.Schema(
  {
    sent: { type: Boolean, default: false },
    sentAt: { type: Date },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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

// NEW: Lecturer entry for multi-lecturer support
const lecturerEntrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    whatsapp: { type: String, required: true },
    response: {
      type: String,
      enum: ["pending", "yes", "no", "reschedule", null],
      default: "pending",
    },
    respondedAt: { type: Date },
    reminderSent: { type: Boolean, default: false },
  },
  { _id: false }
);

const lectureSchema = new mongoose.Schema(
  {
    course: { type: String, required: true },
    // DEPRECATED: kept for backward compatibility
    lecturer: { type: String },
    lecturerWhatsapp: { type: String },
    // NEW: Multi-lecturer support (up to 3)
    lecturers: { type: [lecturerEntrySchema], default: [] },
    confirmedBy: { type: String }, // Name of lecturer who confirmed
    locked: { type: Boolean, default: false }, // True once YES received
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
    reminder: { type: reminderSchema, default: () => ({}) },
    announcement: { type: announcementSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Helper method to get primary lecturer (first in array or deprecated field)
lectureSchema.methods.getPrimaryLecturer = function () {
  if (this.lecturers && this.lecturers.length > 0) {
    return this.lecturers[0];
  }
  // Fallback to deprecated fields
  if (this.lecturer) {
    return { name: this.lecturer, whatsapp: this.lecturerWhatsapp };
  }
  return null;
};

// Helper to check if all lecturers said NO
lectureSchema.methods.allLecturersDeclined = function () {
  if (!this.lecturers || this.lecturers.length === 0) return false;
  return this.lecturers.every((l) => l.response === "no");
};

// Helper to find lecturer by phone
lectureSchema.methods.findLecturerByPhone = function (phone) {
  // Normalize phone formats
  const normalize = (p) => {
    if (!p) return "";
    let cleaned = p.toString().replace(/[^0-9]/g, "");
    if (cleaned.startsWith("234") && cleaned.length === 13) {
      cleaned = "0" + cleaned.slice(3);
    }
    return cleaned;
  };
  const normalizedPhone = normalize(phone);
  return this.lecturers.find((l) => normalize(l.whatsapp) === normalizedPhone);
};

module.exports = mongoose.model("Lecture", lectureSchema);
