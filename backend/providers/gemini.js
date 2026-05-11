const PROVIDER_NAME = "gemini";

function resolveGeminiModel() {
  const configured = process.env.GEMINI_MODEL;
  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }

  /* Default aligned with current Generative Language REST docs (gemini-2.0-* deprecation). */
  return "gemini-2.5-flash";
}

function geminiGenerateUrl(model) {
  const safeModel = encodeURIComponent(model);
  return `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`;
}

const REQUEST_TIMEOUT_MS = 45000;
const { normalizeSummaryOutput } = require("../utils/summaryText");

function createProviderError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.provider = PROVIDER_NAME;
  return error;
}

function normalizeGeminiApiKey() {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    "";

  const trimmed = String(raw).trim();

  if (!trimmed || trimmed === "your_key_here") {
    return "";
  }

  return trimmed.replace(/^["']|["']$/g, "");
}

function describeGeminiBlockOrFinish(responseBody) {
  const blockReason = responseBody?.promptFeedback?.blockReason;

  if (blockReason) {
    return `Gemini blocked the prompt (${blockReason}).`;
  }

  const candidates = Array.isArray(responseBody?.candidates) ? responseBody.candidates : [];

  for (const candidate of candidates) {
    const finish = candidate?.finishReason;

    if (finish && finish !== "STOP") {
      return `Gemini finished without usable text (${finish}).`;
    }

    const ratings = candidate?.safetyRatings;

    if (Array.isArray(ratings)) {
      const blocked = ratings.filter((rating) => rating?.blocked);

      if (blocked.length) {
        const labels = blocked.map((rating) => rating.category || "UNKNOWN").join(", ");
        return `Gemini safety ratings blocked output (${labels}).`;
      }
    }
  }

  return "";
}

function extractGeminiSummary(responseBody) {
  const candidates = Array.isArray(responseBody?.candidates) ? responseBody.candidates : [];
  const chunks = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }

  return chunks.length ? normalizeSummaryOutput(chunks.join("\n\n")) : "";
}

function resolveMaxOutputTokens(summaryType) {
  switch (summaryType) {
    case "detailed":
      return 8192;
    case "bullets":
      return 4096;
    default:
      /* Keep aligned with prior short-summary behavior */
      return 1024;
  }
}

function buildGenerationConfig(summaryType) {
  const config = {
    temperature: 0.3,
    maxOutputTokens: resolveMaxOutputTokens(summaryType),
  };

  /*
   * Only disable reasoning for modes that need longer visible output.
   * Short summaries keep default Gemini 2.5 behavior + original 1024 cap.
   */
  if (summaryType === "detailed" || summaryType === "bullets") {
    config.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  return config;
}

async function summarize({ prompt, requestId, summaryType = "short" }) {
  const apiKey = normalizeGeminiApiKey();

  if (!apiKey) {
    throw createProviderError(500, "Gemini API key is missing.", "missing_api_key");
  }

  const model = resolveGeminiModel();
  const url = geminiGenerateUrl(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    console.log(
      JSON.stringify({
        requestId,
        event: "provider_request_sent",
        provider: PROVIDER_NAME,
        model,
        summaryType,
      })
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        generationConfig: buildGenerationConfig(summaryType),
        contents: [
          {
            parts: [
              {
                text: `${prompt.system}\n\n${prompt.user}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let responseBody = null;

    try {
      responseBody = rawText ? JSON.parse(rawText) : null;
    } catch {
      responseBody = null;
    }

    console.log(
      JSON.stringify({
        requestId,
        event: "provider_response_received",
        provider: PROVIDER_NAME,
        status: response.status,
        ok: response.ok,
        bodyPreview: String(rawText || "").slice(0, 600),
      })
    );

    if (!response.ok) {
      const apiMessage =
        responseBody?.error?.message ||
        (rawText && rawText.length < 600 ? rawText.trim() : "") ||
        `Gemini API request failed with status ${response.status}.`;
      const errorCode = responseBody?.error?.status || "api_error";
      throw createProviderError(response.status, apiMessage, errorCode);
    }

    const summary = extractGeminiSummary(responseBody);

    if (!summary) {
      const detail = describeGeminiBlockOrFinish(responseBody);
      const thoughts = responseBody?.usageMetadata?.thoughtsTokenCount;
      const candidatesTokens = responseBody?.usageMetadata?.candidatesTokenCount;
      const hint =
        typeof thoughts === "number" && thoughts > 0 && (!candidatesTokens || candidatesTokens === 0)
          ? ` Output budget may have been consumed by reasoning tokens (thoughtsTokenCount=${thoughts}).`
          : "";
      throw createProviderError(
        502,
        `${detail || "Gemini returned an empty or invalid summary response."}${hint}`,
        "invalid_response"
      );
    }

    return summary;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createProviderError(504, "Gemini request timed out.", "timeout");
    }

    if (error.provider === PROVIDER_NAME) {
      throw error;
    }

    throw createProviderError(502, error.message || "Gemini request failed.", "network_error");
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  name: PROVIDER_NAME,
  summarize,
};
