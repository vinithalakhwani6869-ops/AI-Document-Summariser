const geminiProvider = require("../providers/gemini");
const cohereProvider = require("../providers/cohere");
const huggingFaceProvider = require("../providers/huggingface");

const MAX_SUMMARY_INPUT_LENGTH = 5000;
const DEFAULT_SUMMARY_ERROR =
  "Summarization service is temporarily unavailable. Please try again in a few seconds.";
const SUMMARY_TYPE_CONFIG = {
  short: {
    label: "Short",
    cohereInstruction:
      "Create a short executive summary in one compact paragraph with 3 to 4 sentences.",
    huggingFacePrefix:
      "Create a short executive summary in one compact paragraph with 3 to 4 sentences.\n\n",
  },
  detailed: {
    label: "Detailed",
    cohereInstruction:
      "Create a detailed summary with a short overview paragraph followed by several explanatory paragraphs covering the main ideas clearly.",
    huggingFacePrefix:
      "Create a detailed summary with a short overview paragraph followed by several explanatory paragraphs covering the main ideas clearly.\n\n",
  },
  bullets: {
    label: "Bullet Points",
    cohereInstruction:
      "Create a concise summary using bullet points only. Start with a brief one-line overview, then add clear bullet points for the key takeaways.",
    huggingFacePrefix:
      "Create a concise summary using bullet points only. Start with a brief one-line overview, then add clear bullet points for the key takeaways.\n\n",
  },
};
const PROVIDERS = [geminiProvider, cohereProvider, huggingFaceProvider];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateTextForSummarization(text) {
  if (text.length <= MAX_SUMMARY_INPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_SUMMARY_INPUT_LENGTH)}...`;
}

function getSummaryTypeConfig(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] || SUMMARY_TYPE_CONFIG.short;
}

function normalizeSummaryType(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] ? summaryType : "short";
}

function buildSummaryPrompt(fileName, excerpt, summaryType) {
  const typeConfig = getSummaryTypeConfig(summaryType);

  return {
    system:
      "You summarize documents for a professional web app. Keep the output polished, readable, and useful.",
    user: `File name: ${fileName}\nSummary type: ${typeConfig.label}\nInstructions: ${typeConfig.cohereInstruction}\n\nDocument text:\n${excerpt}`,
    huggingFaceInput: `${typeConfig.huggingFacePrefix}File name: ${fileName}\nDocument text:\n${excerpt}`,
  };
}

function logProviderFailure({ requestId, provider, summaryType, excerptLength, error }) {
  console.warn(
    JSON.stringify({
      requestId,
      event: "provider_failed",
      provider,
      summaryType,
      excerptLength,
      reason: error?.message || "Unknown error",
      status: error?.status || 500,
      code: error?.code || null,
      stack: error?.stack ? String(error.stack).slice(0, 1200) : null,
    })
  );
}

async function summarizeDocument(text, fileName, summaryType, requestId) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw createHttpError(400, "The uploaded document does not contain readable text.");
  }

  const excerpt = truncateTextForSummarization(normalizedText);
  const prompt = buildSummaryPrompt(fileName, excerpt, summaryType);

  const failureEvents = [];
  let lastError = null;

  for (const provider of PROVIDERS) {
    try {
      return await provider.summarize({
        excerpt,
        fileName,
        prompt,
        requestId,
        summaryType,
      });
    } catch (error) {
      lastError = error;
      failureEvents.push({
        provider: provider.name,
        status: error?.status || 500,
        code: error?.code || null,
        reason: error?.message || "Unknown error",
      });

      logProviderFailure({
        requestId,
        provider: provider.name,
        summaryType,
        excerptLength: typeof excerpt === "string" ? excerpt.length : null,
        error,
      });
    }
  }

  console.error(
    JSON.stringify({
      requestId,
      event: "summarization_failed",
      summaryType,
      excerptLength: excerpt.length,
      failures: failureEvents,
      lastReason: lastError?.message || "Unknown error",
    })
  );

  throw createHttpError(502, DEFAULT_SUMMARY_ERROR);
}

module.exports = {
  summarizeDocument,
  normalizeSummaryType,
};
