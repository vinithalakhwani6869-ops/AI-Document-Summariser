const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const {
  getFirebaseAuth,
  getFirebaseDb,
  getPublicFirebaseConfig,
  hasPublicFirebaseConfig,
} = require("./firebaseAdmin");

dotenv.config();
console.log("HF KEY LOADED:", Boolean(process.env.HUGGINGFACE_API_KEY));
console.log("COHERE KEY LOADED:", Boolean(process.env.COHERE_API_KEY));

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_COMBINED_TEXT_LENGTH = 18000;
const HISTORY_LIMIT = 30;
const COHERE_API_URL = "https://api.cohere.com/v2/chat";
const COHERE_MODEL = "command-a-03-2025";
const HUGGING_FACE_MODEL = "sshleifer/distilbart-cnn-12-6";
const HUGGING_FACE_API_URL = `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`;
const MAX_SUMMARY_INPUT_LENGTH = 5000;
const MAX_HUGGING_FACE_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const DEFAULT_SUMMARY_ERROR =
  "Summarization service is temporarily unavailable. Please try again in a few seconds.";
const DEFAULT_FILE_PLACEHOLDER = "document";
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
const supportedFileTypes = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".txt": ["text/plain", "application/octet-stream"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream",
  ],
};

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowedMimeTypes = supportedFileTypes[extension];

    if (!allowedMimeTypes || !allowedMimeTypes.includes(file.mimetype)) {
      cb(createHttpError(400, "Only PDF, TXT, and DOCX files are supported."));
      return;
    }

    cb(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..")));

app.use((req, res, next) => {
  req.requestId = randomUUID();
  const startedAt = Date.now();

  console.log(`[${req.requestId}] ${req.method} ${req.originalUrl}`);

  res.on("finish", () => {
    console.log(
      `[${req.requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`
    );
  });

  next();
});

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function logServerError(error, req, context = "server") {
  const requestLabel = req?.requestId ? `[${req.requestId}]` : "[no-request-id]";
  console.error(`${requestLabel} ${context}: ${error.message}`);

  if (error.stack) {
    console.error(error.stack);
  }
}

function getSummaryTypeConfig(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] || SUMMARY_TYPE_CONFIG.short;
}

function normalizeSummaryType(summaryType) {
  return SUMMARY_TYPE_CONFIG[summaryType] ? summaryType : "short";
}

function escapeFirestoreTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toISOString();
  }

  return timestamp;
}

async function requireAuth(req, res, next) {
  try {
    const authorizationHeader = req.headers.authorization || "";
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw createHttpError(401, "Authentication is required. Please sign in first.");
    }

    const decodedToken = await getFirebaseAuth().verifyIdToken(match[1]);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
    };

    next();
  } catch (error) {
    if (!error.status) {
      if (error.message.includes("Firebase Admin credentials are missing")) {
        error.status = 500;
      } else {
        error.status = 401;
        error.message = "Your session is invalid or expired. Please sign in again.";
      }
    }

    next(error);
  }
}

async function attachOptionalUser(req, res, next) {
  const authorizationHeader = req.headers.authorization || "";
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    req.user = null;
    next();
    return;
  }

  try {
    const decodedToken = await getFirebaseAuth().verifyIdToken(match[1]);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
    };
  } catch (error) {
    logServerError(error, req, "optional-auth");
    req.user = null;
  }

  next();
}

async function extractTextFromFile(file) {
  if (!file) {
    throw createHttpError(400, "Please upload a document before summarizing.");
  }

  const extension = path.extname(file.originalname || "").toLowerCase();

  if (file.mimetype === "text/plain" || extension === ".txt") {
    return file.buffer.toString("utf-8").trim();
  }

  if (file.mimetype === "application/pdf" || extension === ".pdf") {
    const { text } = await pdfParse(file.buffer);
    return text.trim();
  }

  if (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value.trim();
  }

  throw createHttpError(400, "Unsupported file type.");
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncateTextForSummarization(text) {
  if (text.length <= MAX_SUMMARY_INPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_SUMMARY_INPUT_LENGTH)}...`;
}

function buildCombinedDocumentText(filesWithText) {
  const combinedSections = [];
  let characterCount = 0;

  for (const file of filesWithText) {
    if (!file.text) {
      continue;
    }

    const section = `File: ${file.fileName}\n${file.text}`;

    if (characterCount + section.length > MAX_COMBINED_TEXT_LENGTH) {
      const remaining = MAX_COMBINED_TEXT_LENGTH - characterCount;

      if (remaining > 0) {
        combinedSections.push(section.slice(0, remaining));
        characterCount += remaining;
      }

      break;
    }

    combinedSections.push(section);
    characterCount += section.length;
  }

  return {
    extractedText: combinedSections.join("\n\n---\n\n").trim(),
    characterCount,
  };
}

async function extractTextFromFiles(files) {
  if (!Array.isArray(files) || !files.length) {
    throw createHttpError(400, "Please upload at least one document before summarizing.");
  }

  const fileResults = [];

  for (const file of files) {
    const extractedText = normalizeText(await extractTextFromFile(file));

    if (extractedText) {
      fileResults.push({
        fileName: file.originalname,
        extractedText,
      });
    }
  }

  if (!fileResults.length) {
    throw createHttpError(400, "The uploaded document does not contain readable text.");
  }

  const combined = buildCombinedDocumentText(
    fileResults.map((file) => ({
      fileName: file.fileName,
      text: file.extractedText,
    }))
  );

  if (!combined.extractedText) {
    throw createHttpError(
      400,
      "The uploaded files could not be combined into readable text for summarization."
    );
  }

  return {
    fileName: fileResults.length === 1 ? fileResults[0].fileName : `${fileResults.length} files`,
    fileNames: fileResults.map((file) => file.fileName),
    files: fileResults.map((file) => ({
      fileName: file.fileName,
      characterCount: file.extractedText.length,
    })),
    extractedText: combined.extractedText,
    characterCount: combined.characterCount,
  };
}

function extractHuggingFaceSummary(responseBody) {
  if (Array.isArray(responseBody)) {
    for (const item of responseBody) {
      if (typeof item?.summary_text === "string" && item.summary_text.trim()) {
        return item.summary_text.trim();
      }
    }
  }

  if (typeof responseBody?.summary_text === "string" && responseBody.summary_text.trim()) {
    return responseBody.summary_text.trim();
  }

  return "";
}

function cleanSummaryOutput(summary) {
  return summary.replace(/\s+/g, " ").trim();
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

function extractCohereSummary(responseBody) {
  const contentItems = Array.isArray(responseBody?.message?.content)
    ? responseBody.message.content
    : [];

  for (const item of contentItems) {
    if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return item.text.trim();
    }
  }

  if (typeof responseBody?.text === "string" && responseBody.text.trim()) {
    return responseBody.text.trim();
  }

  return "";
}

async function requestCohereSummary(excerpt, fileName, summaryType, req) {
  if (!process.env.COHERE_API_KEY || process.env.COHERE_API_KEY === "your_key_here") {
    throw createHttpError(
      500,
      "Cohere API key is missing. Add a valid key in backend/.env to enable primary summarization."
    );
  }

  const prompt = buildSummaryPrompt(fileName, excerpt, summaryType);
  console.log(`[${req.requestId}] cohere: attempting primary summarization`);

  const response = await fetch(COHERE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
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
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const apiError =
      responseBody?.message ||
      responseBody?.error ||
      `Cohere API request failed with status ${response.status}.`;
    const error = createHttpError(response.status, apiError);
    error.responseBody = responseBody;
    throw error;
  }

  const summary = cleanSummaryOutput(extractCohereSummary(responseBody));

  if (!summary) {
    throw createHttpError(502, "Cohere returned an empty or invalid summary response.");
  }

  console.log(`[${req.requestId}] cohere: primary summarization succeeded`);
  return summary;
}

function isModelLoadingResponse(responseBody) {
  const errorMessage =
    typeof responseBody?.error === "string" ? responseBody.error.toLowerCase() : "";

  return errorMessage.includes("model is currently loading");
}

function hasHuggingFaceError(responseBody) {
  return typeof responseBody?.error === "string" && responseBody.error.trim().length > 0;
}

async function requestHuggingFaceSummary(excerpt, fileName, summaryType, req) {
  const prompt = buildSummaryPrompt(fileName, excerpt, summaryType);
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_HUGGING_FACE_RETRIES; attempt += 1) {
    let responseBody = null;

    try {
      const response = await fetch(HUGGING_FACE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt.huggingFaceInput,
          parameters: {
            max_length: 220,
            min_length: 60,
            do_sample: false,
          },
          options: {
            wait_for_model: true,
            use_cache: true,
          },
        }),
      });

      responseBody = await response.json().catch(() => null);
      console.log("HF RAW RESPONSE:", responseBody);

      if (Array.isArray(responseBody)) {
        const summary = cleanSummaryOutput(extractHuggingFaceSummary(responseBody));

        if (summary) {
          return summary;
        }
      }

      if (isModelLoadingResponse(responseBody)) {
        const loadingError = createHttpError(503, responseBody.error);
        lastError = loadingError;

        if (attempt < MAX_HUGGING_FACE_RETRIES) {
          console.warn(
            `[${req.requestId}] huggingface retry ${attempt}/${MAX_HUGGING_FACE_RETRIES}: ${responseBody.error}`
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        break;
      }

      if (hasHuggingFaceError(responseBody)) {
        const apiError = createHttpError(502, responseBody.error);
        lastError = apiError;

        if (attempt < MAX_HUGGING_FACE_RETRIES) {
          console.warn(
            `[${req.requestId}] huggingface retry ${attempt}/${MAX_HUGGING_FACE_RETRIES}: ${responseBody.error}`
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        break;
      }

      if (!response.ok) {
        const statusError = createHttpError(
          response.status,
          `Hugging Face API request failed with status ${response.status}.`
        );
        lastError = statusError;

        if (attempt < MAX_HUGGING_FACE_RETRIES) {
          console.warn(
            `[${req.requestId}] huggingface retry ${attempt}/${MAX_HUGGING_FACE_RETRIES}: ${statusError.message}`
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        break;
      }

      const summary = cleanSummaryOutput(extractHuggingFaceSummary(responseBody));

      if (summary) {
        return summary;
      }

      lastError = createHttpError(
        502,
        "The summarization service returned an empty or unexpected response."
      );

      if (attempt < MAX_HUGGING_FACE_RETRIES) {
        console.warn(
          `[${req.requestId}] huggingface retry ${attempt}/${MAX_HUGGING_FACE_RETRIES}: ${lastError.message}`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      break;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_HUGGING_FACE_RETRIES) {
        console.warn(
          `[${req.requestId}] huggingface retry ${attempt}/${MAX_HUGGING_FACE_RETRIES}: ${error.message}`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      break;
    }
  }

  console.error(
    `[${req.requestId}] huggingface final failure after ${MAX_HUGGING_FACE_RETRIES} attempts: ${lastError?.message || "Unknown error"}`
  );

  throw createHttpError(
    502,
    DEFAULT_SUMMARY_ERROR
  );
}

async function saveSummaryToHistory({ userId, fileName, summary, summaryType }) {
  const db = getFirebaseDb();
  const createdAt = new Date();

  const summaryRecord = {
    userId,
    fileName,
    summary,
    summaryType,
    createdAt,
  };

  const docRef = await db
    .collection("users")
    .doc(userId)
    .collection("summaries")
    .add(summaryRecord);

  return {
    id: docRef.id,
    ...summaryRecord,
    createdAt: createdAt.toISOString(),
  };
}

async function getUserHistory(userId) {
  const db = getFirebaseDb();
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("summaries")
    .orderBy("createdAt", "desc")
    .limit(HISTORY_LIMIT)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();

    return {
      id: doc.id,
      userId: data.userId,
      fileName: data.fileName,
      summary: data.summary,
      summaryType: data.summaryType,
      createdAt: escapeFirestoreTimestamp(data.createdAt),
    };
  });
}

async function summarizeDocument(text, fileName, summaryType, req) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw createHttpError(400, "The uploaded document does not contain readable text.");
  }

  const excerpt = truncateTextForSummarization(normalizedText);

  try {
    return await requestCohereSummary(excerpt, fileName, summaryType, req);
  } catch (cohereError) {
    logServerError(cohereError, req, "cohere");
    console.warn(`[${req.requestId}] cohere: falling back to huggingface`);

    if (
      !process.env.HUGGINGFACE_API_KEY ||
      process.env.HUGGINGFACE_API_KEY === "your_key_here"
    ) {
      console.error(
        `[${req.requestId}] summarization final failure: Cohere failed and Hugging Face API key is missing`
      );
      throw createHttpError(502, DEFAULT_SUMMARY_ERROR);
    }

    try {
      return await requestHuggingFaceSummary(excerpt, fileName, summaryType, req);
    } catch (huggingFaceError) {
      logServerError(huggingFaceError, req, "huggingface");
      console.error(
        `[${req.requestId}] summarization final failure: Cohere and Hugging Face both failed`
      );
      throw createHttpError(502, DEFAULT_SUMMARY_ERROR);
    }
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "file.html"));
});

app.get("/api/config", (req, res) => {
  res.json({
    firebase: getPublicFirebaseConfig(),
    firebaseConfigured: hasPublicFirebaseConfig(),
  });
});

app.get("/api/history", requireAuth, async (req, res, next) => {
  try {
    const items = await getUserHistory(req.user.uid);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", attachOptionalUser, upload.array("document", MAX_FILES), async (req, res, next) => {
  try {
    const uploadResult = await extractTextFromFiles(req.files);
    res.json(uploadResult);
  } catch (error) {
    next(error);
  }
});

app.post("/api/summarize", attachOptionalUser, async (req, res, next) => {
  try {
    const {
      text,
      fileName = DEFAULT_FILE_PLACEHOLDER,
      summaryType = "short",
    } = req.body;

    if (!text || typeof text !== "string") {
      throw createHttpError(400, "No document text was provided for summarization.");
    }

    const normalizedSummaryType = normalizeSummaryType(summaryType);
    const summary = await summarizeDocument(text, fileName, normalizedSummaryType, req);
    const historyItem = req.user
      ? await saveSummaryToHistory({
          userId: req.user.uid,
          fileName,
          summary,
          summaryType: normalizedSummaryType,
        })
      : null;

    res.json({ summary, historyItem });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found.",
  });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: "File is too large. Please upload a document smaller than 10 MB.",
      });
      return;
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      res.status(400).json({
        error: `Please upload no more than ${MAX_FILES} files at a time.`,
      });
      return;
    }
  }

  if (error.message === "Unexpected field") {
    res.status(400).json({
      error: "Invalid upload field. Please use the document upload form.",
    });
    return;
  }

  if (error instanceof SyntaxError && error.type === "entity.parse.failed") {
    res.status(400).json({
      error: "Invalid JSON body. Please check the request payload and try again.",
    });
    return;
  }

  logServerError(error, req);

  const status = error.status || 500;
  const message =
    status >= 500
      ? error.message || "Something went wrong while processing your request."
      : error.message;

  res.status(status).json({ error: message });
});

process.on("uncaughtException", (error) => {
  logServerError(error, null, "uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logServerError(error, null, "unhandledRejection");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
