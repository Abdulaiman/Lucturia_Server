// model/processedInboundModel.js
const mongoose = require("mongoose");

const processedInboundSchema = new mongoose.Schema(
  {
    waMessageId: { type: String, required: true, unique: true }, // inbound WAMID
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture" },
    from: { type: String }, // normalized lecturer phone for reference
    type: { type: String }, // text | document | etc.
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProcessedInbound", processedInboundSchema);
