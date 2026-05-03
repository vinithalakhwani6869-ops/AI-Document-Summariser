/**
 * Normalize provider output without collapsing paragraph breaks (critical for "detailed" summaries).
 */
function normalizeSummaryOutput(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  normalizeSummaryOutput,
};
