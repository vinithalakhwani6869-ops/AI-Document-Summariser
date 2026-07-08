const PROVIDER_NAME = "cohere";
const COHERE_API_URL = "https://api.cohere.com/v2/chat";
const COHERE_MODEL = "command-a-03-2025";
const REQUEST_TIMEOUT_MS = 45000;
const { normalizeSummaryOutput } = require("../utils/summaryText");

function createProviderError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.provider = PROVIDER_NAME;
  return error;
}

function extractCohereSummary(responseBody) {
  const contentItems = Array.isArray(responseBody?.message?.content)
    ? responseBody.message.content
    : [];

  for (const item of contentItems) {
    if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return normalizeSummaryOutput(item.text);
    }
  }

  if (typeof responseBody?.text === "string" && responseBody.text.trim()) {
    return normalizeSummaryOutput(responseBody.text);
  }

  return "";
}

function resolveMaxTokens(summaryType) {
  switch (summaryType) {
    case "references":
      return 2500;
    case "claims":
      return 1500;
    case "summary":
    default:
      return 500;
  }
}

async function summarize({ prompt, requestId, summaryType = "summary" }) {
  const apiKey = process.env.COHERE_API_KEY;

  if (!apiKey || apiKey === "your_key_here") {
    throw createProviderError(500, "Cohere API key is missing.", "missing_api_key");
  }

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
        summaryType,
        model: COHERE_MODEL,
      })
    );
    const response = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        stream: false,
        temperature: 0.3,
        max_tokens: resolveMaxTokens(summaryType),
        messages: [
          {
            role: "system",
            content: prompt.system,
          },
          {
            role: "user",
            content: prompt.user,
          },
        ],
      }),
      signal: controller.signal,
    });

    const responseBody = await response.json().catch(() => null);
    console.log(
      JSON.stringify({
        requestId,
        event: "provider_response_received",
        provider: PROVIDER_NAME,
        status: response.status,
        ok: response.ok,
        bodyPreview: JSON.stringify(responseBody || {}).slice(0, 600),
      })
    );

    if (!response.ok) {
      const apiMessage =
        responseBody?.message ||
        responseBody?.error ||
        `Cohere API request failed with status ${response.status}.`;
      let errorCode = "api_error";

      if (response.status === 401) {
        errorCode = "invalid_api_key";
      } else if (response.status === 402) {
        errorCode = "quota_exceeded";
      } else if (response.status === 403) {
        errorCode = "model_access_blocked";
      } else if (response.status === 429) {
        errorCode = "rate_limited";
      } else if (response.status >= 500) {
        errorCode = "provider_unavailable";
      }

      throw createProviderError(response.status, apiMessage, errorCode);
    }

    const summary = extractCohereSummary(responseBody);

    if (!summary) {
      throw createProviderError(
        502,
        "Cohere returned an empty or invalid summary response.",
        "invalid_response"
      );
    }

    return summary;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createProviderError(504, "Cohere request timed out.", "timeout");
    }

    if (error.provider === PROVIDER_NAME) {
      throw error;
    }

    throw createProviderError(502, error.message || "Cohere request failed.", "network_error");
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  name: PROVIDER_NAME,
  summarize,
};
