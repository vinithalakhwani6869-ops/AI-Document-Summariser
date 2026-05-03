const PROVIDER_NAME = "cohere";
const COHERE_API_URL = "https://api.cohere.com/v2/chat";
const COHERE_MODEL = "command-a-03-2025";
const REQUEST_TIMEOUT_MS = 20000;

function createProviderError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.provider = PROVIDER_NAME;
  return error;
}

function cleanSummary(summary) {
  return typeof summary === "string" ? summary.replace(/\s+/g, " ").trim() : "";
}

function extractCohereSummary(responseBody) {
  const contentItems = Array.isArray(responseBody?.message?.content)
    ? responseBody.message.content
    : [];

  for (const item of contentItems) {
    if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return cleanSummary(item.text);
    }
  }

  if (typeof responseBody?.text === "string" && responseBody.text.trim()) {
    return cleanSummary(responseBody.text);
  }

  return "";
}

async function summarize({ prompt }) {
  const apiKey = process.env.COHERE_API_KEY;

  if (!apiKey || apiKey === "your_key_here") {
    throw createProviderError(500, "Cohere API key is missing.", "missing_api_key");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
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
        max_tokens: 220,
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

    if (!response.ok) {
      const apiMessage =
        responseBody?.message ||
        responseBody?.error ||
        `Cohere API request failed with status ${response.status}.`;
      throw createProviderError(response.status, apiMessage, "api_error");
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
