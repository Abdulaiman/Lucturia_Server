// file: scripts/seedUsersAndJoin.js
// Usage: node scripts/seedUsersAndJoin.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Adjust these requires to your project structure
const User = require("./src/model/userModel"); // expects fields: fullName, regNumber, whatsappNumber, class
const Class = require("./src/model/classModel"); // expects fields: _id, title

// Optional: if you have this util in your codebase
let sendWelcomeTemplate = async () => {};
try {
  // Adjust path if different
  ({ sendWelcomeTemplate } = require("./src/services/whatsapp"));
} catch (e) {
  console.warn(
    "sendWelcomeTemplate not found; welcome messages will be skipped"
  );
}

// Helper: keep only first two name parts
function firstTwoNames(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

async function main() {
  // Fixed to local JSON by request
  const fileArg = "./classmembers.json";
  const filePath = path.resolve(fileArg);

  if (!fs.existsSync(filePath)) {
    console.error(`Input file not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let rows = [];
  try {
    rows = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON input:", e.message);
    process.exit(1);
  }

  if (!Array.isArray(rows)) {
    console.error("Input JSON must be an array");
    process.exit(1);
  }

  // Using DATABASE + DATABASE_PASSWORD pattern from your project
  const uri = process?.env?.DATABASE?.replace(
    "<password>",
    process.env.DATABASE_PASSWORD
  );
  if (!uri) {
    console.error("Missing MONGODB_URI/DATABASE env var");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB`);

  const classCache = new Map();

  const getClassById = async (classId) => {
    if (!classId) return null;
    if (classCache.has(classId)) return classCache.get(classId);
    const cls = await Class.findById(classId);
    if (!cls) throw new Error(`Class not found: ${classId}`);
    classCache.set(classId, cls);
    return cls;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const idx = i + 1;

    const rawName = row.fullName ?? "";
    const fullName = firstTwoNames(rawName); // ensure only two names are saved
    const regNumber = row.regNumber?.trim();
    const whatsappNumber = row.whatsappNumber?.trim();
    const classId = row.class?.toString();

    if (!fullName || !regNumber || !whatsappNumber) {
      console.warn(`Row ${idx}: skipped (missing required fields)`);
      continue;
    }

    // Normalize phone if desired, e.g., remove spaces
    const phone = whatsappNumber.replace(/\s+/g, "");

    // Find existing by regNumber or phone
    let user =
      (await User.findOne({ regNumber })) ||
      (await User.findOne({ whatsappNumber: phone }));

    if (!user) {
      user = await User.create({ fullName, regNumber, whatsappNumber: phone });
      console.log(`Row ${idx}: created user ${fullName} (${regNumber})`);
    } else {
      // Update fields to keep them fresh
      user.fullName = fullName; // keep two-part name
      user.whatsappNumber = phone;
      await user.save();
      console.log(`Row ${idx}: updated user ${fullName} (${regNumber})`);
    }

    if (classId) {
      try {
        const myClass = await getClassById(classId);

        // If user belongs to a different class, respect your business rule
        if (user.class && user.class.toString() !== classId) {
          console.warn(
            `Row ${idx}: user already in another class (${user.class}), skipping reassignment`
          );
        } else {
          user.class = classId;
          await user.save();
          console.log(`Row ${idx}: joined class ${myClass.title} (${classId})`);

          try {
            await sendWelcomeTemplate(
              user.whatsappNumber,
              user.fullName,
              myClass.title
            );
            console.log(`Row ${idx}: welcome template sent`);
          } catch (err) {
            console.warn(
              `Row ${idx}: failed to send welcome template: ${
                err.response?.data || err.message
              }`
            );
          }
        }
      } catch (e) {
        console.warn(`Row ${idx}: class error: ${e.message}`);
      }
    } else {
      console.log(`Row ${idx}: no classId provided, user created/updated only`);
    }
  }

  await mongoose.disconnect();
  console.log("Done");
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
