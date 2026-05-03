const PROVIDER_NAME = "huggingface";
const HUGGING_FACE_MODEL = "sshleifer/distilbart-cnn-12-6";
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${encodeURIComponent(
  HUGGING_FACE_MODEL
)}`;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 45000;
const { normalizeSummaryOutput } = require("../utils/summaryText");

function createProviderError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.provider = PROVIDER_NAME;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractSummary(responseBody) {
  if (Array.isArray(responseBody)) {
    for (const item of responseBody) {
      if (typeof item?.summary_text === "string" && item.summary_text.trim()) {
        return normalizeSummaryOutput(item.summary_text);
      }
    }
  }

  if (typeof responseBody?.summary_text === "string" && responseBody.summary_text.trim()) {
    return normalizeSummaryOutput(responseBody.summary_text);
  }

  return "";
}

function getResponseErrorMessage(responseBody) {
  return typeof responseBody?.error === "string" ? responseBody.error.trim() : "";
}

function isModelLoading(responseBody) {
  return getResponseErrorMessage(responseBody).toLowerCase().includes("model is currently loading");
}

function resolveGenerationLengths(summaryType) {
  switch (summaryType) {
    case "detailed":
      return { max_length: 512, min_length: 120 };
    case "bullets":
      return { max_length: 380, min_length: 80 };
    default:
      return { max_length: 220, min_length: 60 };
  }
}

async function summarize({ prompt, requestId, summaryType = "short" }) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!apiKey || apiKey === "your_key_here") {
    throw createProviderError(500, "Hugging Face API key is missing.", "missing_api_key");
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(HUGGING_FACE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt.huggingFaceInput,
          parameters: {
            ...resolveGenerationLengths(summaryType),
            do_sample: false,
          },
          options: {
            wait_for_model: true,
            use_cache: true,
          },
        }),
        signal: controller.signal,
      });

      const responseBody = await response.json().catch(() => null);
      const summary = extractSummary(responseBody);

      if (summary) {
        return summary;
      }

      if (isModelLoading(responseBody)) {
        lastError = createProviderError(503, getResponseErrorMessage(responseBody), "model_loading");
      } else if (getResponseErrorMessage(responseBody)) {
        lastError = createProviderError(502, getResponseErrorMessage(responseBody), "api_error");
      } else if (!response.ok) {
        lastError = createProviderError(
          response.status,
          `Hugging Face API request failed with status ${response.status}.`,
          "api_error"
        );
      } else {
        lastError = createProviderError(
          502,
          "Hugging Face returned an empty or invalid summary response.",
          "invalid_response"
        );
      }
    } catch (error) {
      if (error.name === "AbortError") {
        lastError = createProviderError(504, "Hugging Face request timed out.", "timeout");
      } else if (error.provider === PROVIDER_NAME) {
        lastError = error;
      } else {
        lastError = createProviderError(
          502,
          error.message || "Hugging Face request failed.",
          "network_error"
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < MAX_RETRIES) {
      console.warn(
        JSON.stringify({
          requestId,
          event: "provider_retry",
          provider: PROVIDER_NAME,
          attempt,
          maxRetries: MAX_RETRIES,
          reason: lastError.message,
          code: lastError.code || null,
        })
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError || createProviderError(502, "Hugging Face request failed.", "unknown_error");
}

module.exports = {
  name: PROVIDER_NAME,
  summarize,
};
