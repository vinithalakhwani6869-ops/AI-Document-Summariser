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
const {
  summarizeDocument,
  normalizeSummaryType,
} = require("./services/summarizerService");

dotenv.config({ path: path.join(__dirname, ".env") });
console.log("GEMINI KEY LOADED:", Boolean(process.env.GEMINI_API_KEY));
console.log("COHERE KEY LOADED:", Boolean(process.env.COHERE_API_KEY));
console.log("HF KEY LOADED:", Boolean(process.env.HUGGINGFACE_API_KEY));

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_COMBINED_TEXT_LENGTH = 18000;
const HISTORY_LIMIT = 30;
const DEFAULT_FILE_PLACEHOLDER = "document";
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
    const summary = await summarizeDocument(
      text,
      fileName,
      normalizedSummaryType,
      req.requestId
    );
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
