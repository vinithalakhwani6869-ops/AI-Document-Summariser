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

function isEnglishLanguage(language) {
  return !language || String(language).trim().toLowerCase() === "english";
}

function resolveMaxOutputTokens(summaryType, language) {
  const english = isEnglishLanguage(language);
  switch (summaryType) {
    case "detailed":
      return 8192;
    case "bullets":
      return 4096;
    default:
      return english ? 1024 : 2048;
  }
}

function buildGenerationConfig(summaryType, language) {
  const config = {
    temperature: 0.3,
    maxOutputTokens: resolveMaxOutputTokens(summaryType, language),
  };

  config.thinkingConfig = {
    thinkingBudget: 0,
  };

  return config;
}

async function summarize({ prompt, requestId, summaryType = "short", language = "English" }) {
  const apiKey = normalizeGeminiApiKey();

  if (!apiKey) {
    throw createProviderError(500, "Gemini API key is missing.", "missing_api_key");
  }

  const keyValidFormat = apiKey.startsWith("AIza");

  console.log(
    JSON.stringify({
      requestId,
      event: "gemini_key_check",
      keyPresent: true,
      keyLength: apiKey.length,
      keyPrefix: apiKey.slice(0, 6),
      validKeyFormat: keyValidFormat,
      model: resolveGeminiModel(),
      endpoint: geminiGenerateUrl(resolveGeminiModel()),
      ...(keyValidFormat
        ? {}
        : {
            warning:
              "GEMINI_API_KEY does not start with 'AIza'. This is likely not a valid Gemini API key. Obtain one from https://aistudio.google.com/apikey",
          }),
    })
  );

  if (!keyValidFormat) {
    console.warn(
      JSON.stringify({
        requestId,
        event: "gemini_key_invalid_format",
        keyPrefix: apiKey.slice(0, 6),
        hint: "API key does not start with 'AIza'. Requests to the Gemini API will likely fail with 401 UNAUTHENTICATED.",
      })
    );
  }

  const model = resolveGeminiModel();
  const url = geminiGenerateUrl(model);
  const generationConfig = buildGenerationConfig(summaryType, language);
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
        language,
        maxOutputTokens: generationConfig.maxOutputTokens,
        thinkingDisabled: Boolean(generationConfig.thinkingConfig),
      })
    );

    const requestBody = {
      generationConfig,
      contents: [
        {
          parts: [
            {
              text: `${prompt.system}\n\n${prompt.user}`,
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let responseBody = null;

    try {
      responseBody = rawText ? JSON.parse(rawText) : null;
    } catch {
      responseBody = null;
    }

    const finishReason =
      responseBody?.candidates?.[0]?.finishReason || "UNKNOWN";
    const usageMetadata = responseBody?.usageMetadata || {};
    const candidatesTokenCount = usageMetadata.candidatesTokenCount || 0;
    const thoughtsTokenCount = usageMetadata.thoughtsTokenCount || 0;
    const promptTokenCount = usageMetadata.promptTokenCount || 0;

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
      const errorReason = responseBody?.error?.details?.[0]?.reason || "";

      console.error(
        JSON.stringify({
          requestId,
          event: "gemini_api_error",
          provider: PROVIDER_NAME,
          status: response.status,
          errorCode,
          errorReason,
          errorMessage: apiMessage,
          model,
        })
      );

      if (response.status === 403 && (errorCode === "PERMISSION_DENIED" || errorReason === "API_KEY_SERVICE_BLOCKED")) {
        throw createProviderError(
          403,
          "The Generative Language API is not enabled for this Google Cloud project. Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com",
          "api_not_enabled"
        );
      }

      throw createProviderError(response.status, apiMessage, errorCode);
    }

    const summary = extractGeminiSummary(responseBody);

    console.log(
      JSON.stringify({
        requestId,
        event: "gemini_output_metrics",
        provider: PROVIDER_NAME,
        language,
        summaryType,
        model,
        maxOutputTokens: generationConfig.maxOutputTokens,
        finishReason,
        outputLengthChars: summary.length,
        candidatesTokenCount,
        thoughtsTokenCount,
        promptTokenCount,
        outputTruncated: finishReason === "MAX_TOKENS",
      })
    );

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        JSON.stringify({
          requestId,
          event: "gemini_output_truncated",
          hint: `finishReason=MAX_TOKENS. The ${language} summary was cut off at ${candidatesTokenCount} output tokens (maxOutputTokens=${generationConfig.maxOutputTokens}). Consider increasing the token budget.`,
          language,
          summaryType,
          maxOutputTokens: generationConfig.maxOutputTokens,
          candidatesTokenCount,
        })
      );
    }

    if (!summary) {
      const detail = describeGeminiBlockOrFinish(responseBody);
      const hint =
        typeof thoughtsTokenCount === "number" && thoughtsTokenCount > 0 && (!candidatesTokenCount || candidatesTokenCount === 0)
          ? ` Output budget may have been consumed by reasoning tokens (thoughtsTokenCount=${thoughtsTokenCount}).`
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
