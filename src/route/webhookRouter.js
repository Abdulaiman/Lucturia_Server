// routes/webhookRoutes.js
const express = require("express");
const {
  verifyWebhook,
  handleWebhook,
} = require("../controller/webhookController");

const router = express.Router();

router.get("/", verifyWebhook); // Verification
router.post("/", handleWebhook); // Incoming messages

module.exports = router;
