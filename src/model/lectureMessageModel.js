// models/LectureMessage.js
const mongoose = require("mongoose");

const lectureMessageSchema = new mongoose.Schema(
  {
    lectureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lecture",
      required: true,
    },
    waMessageId: { type: String, required: true, unique: true }, // WhatsApp message id
    decisionHandled: { type: Boolean, default: false },
    recipient: { type: String }, // lecturer phone number
    type: {
      type: String,
      enum: ["notification", "followup", "contrib_followup"],
      default: "notification",
    },
    buttonId: { type: String }, // e.g. add_note_123
    deliveredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LectureMessage", lectureMessageSchema);
