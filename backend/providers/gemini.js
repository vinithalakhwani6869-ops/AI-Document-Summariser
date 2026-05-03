const PROVIDER_NAME = "gemini";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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

function extractGeminiSummary(responseBody) {
  const candidates = Array.isArray(responseBody?.candidates) ? responseBody.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return cleanSummary(part.text);
      }
    }
  }

  return "";
}

async function summarize({ prompt }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === "your_key_here") {
    throw createProviderError(500, "Gemini API key is missing.", "missing_api_key");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 320,
        },
        contents: [
          {
            role: "user",
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

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const apiMessage =
        responseBody?.error?.message ||
        `Gemini API request failed with status ${response.status}.`;
      const errorCode = responseBody?.error?.status || "api_error";
      throw createProviderError(response.status, apiMessage, errorCode);
    }

    const summary = extractGeminiSummary(responseBody);

    if (!summary) {
      throw createProviderError(
        502,
        "Gemini returned an empty or invalid summary response.",
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
