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
    recipient: { type: String }, // lecturer phone number, optional
    deliveredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LectureMessage", lectureMessageSchema);
