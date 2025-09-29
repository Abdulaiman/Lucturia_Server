// utils/helpers.js
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);
/**
 * ✅ Format a phone number to E.164 standard
 * Removes leading 0, ensures + country code
 */
function formatPhoneNumber(number) {
  if (!number) throw new Error("No phone number provided");

  let formatted = number.toString().trim();

  // remove spaces, dashes, parentheses
  formatted = formatted.replace(/[\s()-]/g, "");

  // if it starts with 00, replace with +
  if (formatted.startsWith("00")) {
    formatted = `+${formatted.slice(2)}`;
  }

  // if it starts with +, leave it
  if (formatted.startsWith("+")) return formatted;

  // if it starts with a single 0, drop it (e.g. 070 -> 70)
  if (formatted.startsWith("0")) {
    formatted = formatted.slice(1);
  }

  // assume Nigeria default (+234) if no country code given
  if (!formatted.startsWith("+")) {
    formatted = `+234${formatted}`;
  }

  return formatted;
}

/**
 * ✅ Extract the first name from full name
 */
function getFirstName(fullName = "") {
  if (!fullName) return "";
  return fullName.trim().split(" ")[0];
}

/**
 * ✅ Format time nicely (e.g. "14:30" -> "2:30 PM")
 */

function formatTime(date) {
  if (!date) return "";
  return dayjs(date).tz("Africa/Lagos").format("h:mm A");
}

/**
 * ✅ Format date nicely (e.g. "2025-09-28" -> "28 Sept 2025")
 */
function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

module.exports = {
  formatPhoneNumber,
  getFirstName,
  formatTime,
  formatDate,
};
