// models/pendingActionModel.js
const mongoose = require("mongoose");

const pendingActionSchema = new mongoose.Schema({
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture" },
  action: {
    type: String,
    enum: ["add_note", "add_document", "awaiting_choice"],
  },
  waMessageId: String, // optional, link to WhatsApp message
  status: {
    type: String,
    enum: ["pending", "completed", "active"],
    default: "pending",
  },
  active: { type: Boolean },
  lecturer: { type: String },
  lecturerWhatsapp: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PendingAction", pendingActionSchema);
