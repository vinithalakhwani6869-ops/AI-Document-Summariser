const geminiProvider = require("../providers/gemini");
const cohereProvider = require("../providers/cohere");
const huggingFaceProvider = require("../providers/huggingface");

const MAX_SUMMARY_INPUT_LENGTH = 80000;
const DEFAULT_SUMMARY_ERROR =
  "Summarization service is temporarily unavailable. Please try again in a few seconds.";
const SUMMARY_TYPE_CONFIG = {
  summary: {
    label: "Summary",
    cohereInstruction:
      "Create a concise research paper summary. Preserve important context. Do not oversimplify.",
    huggingFacePrefix:
      "Create a concise research paper summary. Preserve important context. Do not oversimplify.\n\n",
  },
  claims: {
    label: "Key Claims",
    cohereInstruction:
      "Identify only the major claims made by the authors (including main findings, primary contributions, and important conclusions). Focus only on the paper's central contributions and arguments, avoiding background information or literature review. Format the output strictly as:\n\nClaim 1\nEvidence (if present)\n\nClaim 2\nEvidence\n\nClaim 3\nEvidence\n\nEnsure the response is clean and structured. If no clear research claims can be extracted, output exactly: 'No clear research claims could be extracted.'",
    huggingFacePrefix:
      "Identify only the major claims made by the authors (including main findings, primary contributions, and important conclusions). Focus only on the paper's central contributions and arguments, avoiding background information or literature review. Format the output strictly as:\n\nClaim 1\nEvidence (if present)\n\nClaim 2\nEvidence\n\nClaim 3\nEvidence\n\nEnsure the response is clean and structured. If no clear research claims can be extracted, output exactly: 'No clear research claims could be extracted.'\n\n",
  },
  references: {
    label: "References",
    cohereInstruction:
      "Extract only the paper's bibliography/references. Do NOT summarize or rewrite the citations. Return them exactly as they appear in the text whenever possible. If no references section exists, output exactly: 'No references section detected.'",
    huggingFacePrefix:
      "Extract only the paper's bibliography/references. Do NOT summarize or rewrite the citations. Return them exactly as they appear in the text whenever possible. If no references section exists, output exactly: 'No references section detected.'\n\n",
  },
};
const PROVIDERS = [geminiProvider, cohereProvider, huggingFaceProvider];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function truncateTextForSummarization(text) {
  if (text.length <= MAX_SUMMARY_INPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_SUMMARY_INPUT_LENGTH)}...`;
}

function getSummaryTypeConfig(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] || SUMMARY_TYPE_CONFIG.summary;
}

function normalizeSummaryType(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] ? summaryType : "summary";
}

function buildUserFacingSummaryError(failureEvents = []) {
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

  if (
    statuses.includes(401) ||
    reasons.some((reason) => reason.includes("invalid api key") || reason.includes("unauthorized"))
  ) {
    return "AI provider authentication failed.";
  }

  if (
    statuses.includes(402) ||
    reasons.some((reason) => reason.includes("quota") || reason.includes("credit"))
  ) {
    return "AI provider quota exceeded.";
  }

  if (
    statuses.includes(403) ||
    reasons.some((reason) => reason.includes("forbidden") || reason.includes("blocked model access"))
  ) {
    return "AI provider access is blocked for this model.";
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

function buildSummaryPrompt(fileName, excerpt, summaryType) {
  const typeConfig = getSummaryTypeConfig(summaryType);

  let systemPrompt = "You are an AI research assistant helping students and researchers understand academic papers.";
  if (summaryType === "references") {
    systemPrompt = "You are a precise citation extraction assistant. You only extract references and bibliography exactly as they appear in the text, without summarizing, paraphrasing, or altering the text.";
  } else if (summaryType === "claims") {
    systemPrompt = "You are a research analysis assistant. You identify major claims and evidence in academic papers and output them in a structured format.";
  }

  return {
    system: systemPrompt,
    user: `File name: ${fileName}\nAnalysis type: ${typeConfig.label}\nInstructions: ${typeConfig.cohereInstruction}\n\nDocument text:\n${excerpt}`,
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

function extractReferencesRegex(text) {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  const headerRegex = /^\s*(?:\d+[\.\s]+|[IVXLCDM]+[\.\s]+)?(?:References|Bibliography|Works\s+Cited|Literature\s+Cited|References\s+and\s+Notes)\s*:?\s*$/i;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (headerRegex.test(line)) {
      const referencesText = lines.slice(i + 1).join("\n").trim();
      if (referencesText.length > 30) {
        return referencesText;
      }
    }
  }

  const looseHeaderRegex = /\n\s*(?:\d+[\.\s]+|[IVXLCDM]+[\.\s]+)?(?:References|Bibliography|Works\s+Cited|Literature\s+Cited|References\s+and\s+Notes)\s*:?\s*\n/i;
  const match = text.match(looseHeaderRegex);
  if (match) {
    const index = match.index;
    const matchedText = match[0];
    const referencesText = text.slice(index + matchedText.length).trim();
    if (referencesText.length > 30) {
      return referencesText;
    }
  }

  return null;
}

function getExcerptForReferences(text) {
  if (text.length <= 5000) {
    return text;
  }
  return `...[Truncated]...\n${text.slice(-5000)}`;
}

async function summarizeDocument(text, fileName, summaryType, requestId) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw createHttpError(400, "The uploaded document does not contain readable text.");
  }

  // 1. Special behavior for References mode: regex extraction first
  if (summaryType === "references") {
    const extractedRefs = extractReferencesRegex(normalizedText);
    if (extractedRefs) {
      console.log(`[Citation Extraction] Successfully extracted references via regex for ${fileName}`);
      return extractedRefs;
    }
    console.log(`[Citation Extraction] Regex failed. Falling back to AI for ${fileName}`);
  }

  const excerpt = summaryType === "references"
    ? getExcerptForReferences(normalizedText)
    : truncateTextForSummarization(normalizedText);

  const prompt = buildSummaryPrompt(fileName, excerpt, summaryType);

  const failureEvents = [];
  let lastError = null;

  console.log(
    JSON.stringify({
      requestId,
      event: "summarization_started",
      fileName,
      summaryType,
      inputLength: normalizedText.length,
      truncatedLength: excerpt.length,
      providerOrder: PROVIDERS.map((provider) => provider.name),
    })
  );

  for (const provider of PROVIDERS) {
    try {
      const result = await provider.summarize({
        excerpt,
        fileName,
        prompt,
        requestId,
        summaryType,
      });

      // Post-process response for user friendly messages
      if (summaryType === "references") {
        const cleanResult = result.trim();
        if (!cleanResult || cleanResult.toLowerCase().includes("no references section")) {
          return "No references section was detected.";
        }
      } else if (summaryType === "claims") {
        const cleanResult = result.trim();
        if (!cleanResult || cleanResult.toLowerCase().includes("no clear research claims")) {
          return "No clear research claims could be extracted.";
        }
      }

      return result;
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
  const userMessage = buildUserFacingSummaryError(failureEvents);
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
