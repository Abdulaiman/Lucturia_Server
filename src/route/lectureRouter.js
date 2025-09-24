const express = require("express");
const {
  createLecture,
  getAllLectures,
  getLecturesByClass,
  getLectureById,
  updateLecture,
  deleteLecture,
} = require("../controller/lectureController");

const router = express.Router();

// Create a new lecture (admin only)
router.post("/", createLecture);

// Get all lectures
router.get("/", getAllLectures);

// Get lectures by cohort
router.get("/class/:classId", getLecturesByClass);

// Get single lecture by ID
router.get("/:id", getLectureById);

// Update lecture by ID
router.patch("/:id", updateLecture);

// Delete lecture by ID
router.delete("/:id", deleteLecture);

module.exports = router;
