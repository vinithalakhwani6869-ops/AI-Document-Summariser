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

function buildUserFacingSummaryError(failureEvents = [], usingCustomKey = false) {
  if (!failureEvents.length) {
    return DEFAULT_SUMMARY_ERROR;
  }

  const statuses = failureEvents.map((failure) => Number(failure.status) || 0);
  const reasons = failureEvents
    .map((failure) => String(failure.reason || "").toLowerCase())
    .filter(Boolean);
  const codes = failureEvents
    .map((failure) => String(failure.code || "").toLowerCase())
    .filter(Boolean);

  if (codes.includes("missing_api_key") || reasons.some((reason) => reason.includes("api key is missing"))) {
    return "Missing API configuration.";
  }

  // BYOK failures must read as failures of the user's own key, not of the app.
  if (usingCustomKey) {
    if (
      statuses.includes(401) ||
      codes.includes("invalid_api_key") ||
      codes.includes("api_key_invalid") ||
      reasons.some((reason) => reason.includes("api key not valid") || reason.includes("unauthenticated") || reason.includes("incorrect api key"))
    ) {
      return "Your connected Gemini API key was rejected by Google. Open Settings and reconnect a valid key from https://aistudio.google.com/apikey.";
    }

    if (
      codes.includes("api_not_enabled") ||
      reasons.some((reason) => reason.includes("generative language api is not enabled") || reason.includes("service_disabled"))
    ) {
      return "The Generative Language API is not enabled for the Google project that owns your Gemini API key. Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com";
    }

    if (statuses.includes(429) || reasons.some((reason) => reason.includes("quota") || reason.includes("rate limit"))) {
      return "Your Gemini API key has reached its quota or rate limit. Try again shortly or check your quotas in Google AI Studio.";
    }
  }

  if (codes.includes("api_not_enabled") || reasons.some((reason) => reason.includes("generative language api is not enabled"))) {
    return "Gemini API access is not enabled for this project. Please enable the Generative Language API at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com";
  }

  if (
    statuses.includes(401) ||
    reasons.some((reason) => reason.includes("invalid api key") || reason.includes("unauthorized") || reason.includes("incorrect api key"))
  ) {
    return "AI provider authentication failed. Please verify your API keys are valid.";
  }

  if (
    statuses.includes(402) ||
    reasons.some((reason) => reason.includes("quota") || reason.includes("credit"))
  ) {
    return "AI provider quota exceeded.";
  }

  if (
    statuses.includes(403) ||
    reasons.some((reason) => reason.includes("forbidden") || reason.includes("blocked"))
  ) {
    return "AI provider access is blocked. The Generative Language API may not be enabled. Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com";
  }

  if (statuses.includes(429) || reasons.some((reason) => reason.includes("rate limit"))) {
    return "AI provider rate limit reached. Please try again shortly.";
  }

  if (
    statuses.includes(408) ||
    statuses.includes(504) ||
    codes.includes("timeout") ||
    reasons.some((reason) => reason.includes("timed out"))
  ) {
    return "Request timeout while contacting the AI provider.";
  }

  if (
    statuses.some((status) => status >= 500) ||
    reasons.some((reason) => reason.includes("temporarily unavailable"))
  ) {
    return "Backend unavailable due to upstream AI provider failure.";
  }

  return DEFAULT_SUMMARY_ERROR;
}

function buildSummaryPrompt(fileName, excerpt, summaryType, language = "English") {
  const typeConfig = getSummaryTypeConfig(summaryType);
  const isEnglish = !language || String(language).trim().toLowerCase() === "english";

  const languageInstruction = isEnglish
    ? "Generate the summary directly in English."
    : `Translate the following summary into the selected language. Preserve every piece of information. Do not shorten, summarize, omit, simplify, or paraphrase the content. Return a complete translation only.\n\nGenerate the summary directly in ${language}. Do NOT translate from an intermediate language. Read the uploaded document regardless of its source language and produce the final answer directly in ${language}.`;

  return {
    system:
      "You summarize documents for a professional web app. Keep the output polished, readable, and useful.",
    user: `File name: ${fileName}\nSummary type: ${typeConfig.label}\nLanguage: ${language}\nInstructions: ${typeConfig.cohereInstruction}\n${languageInstruction}\n\nDocument text:\n${excerpt}`,
    huggingFaceInput: `${typeConfig.huggingFacePrefix}File name: ${fileName}\nLanguage: ${language}\n${languageInstruction}\nDocument text:\n${excerpt}`,
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

async function summarizeDocument(text, fileName, summaryType, requestId, language = "English", customApiKey = null) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw createHttpError(400, "The uploaded document does not contain readable text.");
  }

  const excerpt = truncateTextForSummarization(normalizedText);
  const prompt = buildSummaryPrompt(fileName, excerpt, summaryType, language);

  const failureEvents = [];
  let lastError = null;

  // When the caller supplies a user's own API key (BYOK), that key must be the
  // one actually used. Never silently fall back to app-configured providers,
  // otherwise the user thinks their quota is being used while it is not.
  const activeProviders = customApiKey ? [geminiProvider] : PROVIDERS;

  console.log(
    JSON.stringify({
      requestId,
      event: "summarization_started",
      fileName,
      summaryType,
      language,
      inputLength: normalizedText.length,
      truncatedLength: excerpt.length,
      providerOrder: activeProviders.map((provider) => provider.name),
      usingCustomKey: Boolean(customApiKey),
    })
  );

  for (const provider of activeProviders) {
    try {
      const summary = await provider.summarize({
        excerpt,
        fileName,
        prompt,
        requestId,
        summaryType,
        language,
        customApiKey,
      });

      console.log(
        JSON.stringify({
          requestId,
          event: "summarization_succeeded",
          provider: provider.name,
          summaryType,
          language,
          inputLengthChars: excerpt.length,
          outputLengthChars: summary.length,
          languageIsEnglish: !language || String(language).trim().toLowerCase() === "english",
        })
      );

      return summary;
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
      language,
      excerptLength: excerpt.length,
      failures: failureEvents,
      lastReason: lastError?.message || "Unknown error",
    })
  );
  const userMessage = buildUserFacingSummaryError(failureEvents, Boolean(customApiKey));

  console.error(
    JSON.stringify({
      requestId,
      event: "user_facing_error_mapped",
      mappedMessage: userMessage,
      originalFailures: failureEvents.map((f) => ({
        provider: f.provider,
        status: f.status,
        code: f.code,
        reason: f.reason,
      })),
    })
  );

  const error = createHttpError(502, userMessage);
  error.details = {
    userMessage,
    providerFailures: failureEvents,
    providerReason: lastError?.message || "Unknown error",
  };
  throw error;
}

module.exports = {
  summarizeDocument,
  normalizeSummaryType,
};
