// routes/classRoutes.js
const express = require("express");
const {
  createClass,
  getAllClasses,
  getClass,
  joinClass,
  removeStudent,
  findUserByWhatsapp,
  getClassMembers,
} = require("../controller/classController");

const router = express.Router();

router.post("/", createClass);
router.get("/", getAllClasses);
router.get("/:id", getClass);
router.post("/join", joinClass);
router.post("/remove", removeStudent);
router.post("/find-by-whatsapp", findUserByWhatsapp);
router.get("/:classId/members", getClassMembers);

module.exports = router;
