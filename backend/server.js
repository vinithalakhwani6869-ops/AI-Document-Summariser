const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const dotenv = require("dotenv");

const backendEnvPath = path.join(__dirname, ".env");
const rootEnvPath = path.join(__dirname, "..", ".env");

dotenv.config({ path: rootEnvPath });
dotenv.config({ path: backendEnvPath, override: true });

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const {
  getFirebaseAuth,
  getFirebaseDb,
  getPublicFirebaseConfig,
  hasAdminCredentials,
  hasPublicFirebaseConfig,
} = require("./firebaseAdmin");
const {
  summarizeDocument,
  normalizeSummaryType,
} = require("./services/summarizerService");

console.log(
  JSON.stringify({
    event: "startup_environment",
    backendDotenvExists: fs.existsSync(backendEnvPath),
    rootDotenvExists: fs.existsSync(rootEnvPath),
    nodeEnv: process.env.NODE_ENV || "development",
    renderService: process.env.RENDER_SERVICE_NAME || null,
    render: Boolean(process.env.RENDER),
    port: process.env.PORT || null,
    geminiKeyConfigured: Boolean(
      String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim()
    ),
    cohereKeyConfigured: Boolean(String(process.env.COHERE_API_KEY || "").trim()),
    huggingFaceKeyConfigured: Boolean(String(process.env.HUGGINGFACE_API_KEY || "").trim()),
    firebaseAdminConfigured: hasAdminCredentials(),
    firebasePublicConfigured: hasPublicFirebaseConfig(),
    firebaseApiKeyLoaded: Boolean(String(process.env.FIREBASE_API_KEY || "").trim()),
    firebaseAuthDomainLoaded: Boolean(String(process.env.FIREBASE_AUTH_DOMAIN || "").trim()),
    firebaseProjectIdLoaded: Boolean(String(process.env.FIREBASE_PROJECT_ID || "").trim()),
    firebaseStorageBucketLoaded: Boolean(String(process.env.FIREBASE_STORAGE_BUCKET || "").trim()),
    firebaseMessagingSenderIdLoaded: Boolean(
      String(process.env.FIREBASE_MESSAGING_SENDER_ID || "").trim()
    ),
    firebaseAppIdLoaded: Boolean(String(process.env.FIREBASE_APP_ID || "").trim()),
  })
);

const geminiKeyRaw = String(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ""
).trim();
const geminiKeyNormalized = geminiKeyRaw.replace(/^["']|["']$/g, "");
const geminiKeyPresent = Boolean(geminiKeyNormalized && geminiKeyNormalized !== "your_key_here");
const geminiKeyValidFormat = geminiKeyPresent && geminiKeyNormalized.startsWith("AIza");

console.log(
  JSON.stringify({
    event: "gemini_key_validation",
    keyPresent: geminiKeyPresent,
    keyLength: geminiKeyNormalized.length,
    keyPrefix: geminiKeyNormalized ? geminiKeyNormalized.slice(0, 6) : "(empty)",
    validKeyFormat: geminiKeyValidFormat,
    hint: !geminiKeyPresent
      ? "GEMINI_API_KEY is missing from environment."
      : !geminiKeyValidFormat
        ? "GEMINI_API_KEY does not look like a standard Google API key (should start with 'AIza'). Get a key from https://aistudio.google.com/apikey"
        : "GEMINI_API_KEY format looks correct.",
  })
);

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_COMBINED_TEXT_LENGTH = 18000;
const HISTORY_LIMIT = 30;
const DEFAULT_FILE_PLACEHOLDER = "document";
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
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

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(createHttpError(403, `CORS blocked for origin: ${origin}`));
    },
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "..")));

app.use((req, res, next) => {
  req.requestId = randomUUID();
  const startedAt = Date.now();

  console.log(
    JSON.stringify({
      requestId: req.requestId,
      event: "request_started",
      method: req.method,
      url: req.originalUrl,
      origin: req.headers.origin || null,
      userAgent: req.headers["user-agent"] || null,
    })
  );

  res.on("finish", () => {
    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "request_finished",
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      })
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
  console.error(
    JSON.stringify({
      requestId: req?.requestId || null,
      event: "server_error",
      context,
      message: error.message,
      status: error.status || 500,
      code: error.code || null,
      provider: error.provider || null,
      details: error.details || null,
      stack: error.stack ? String(error.stack).slice(0, 2000) : null,
    })
  );
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

function buildFileLog(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  }));
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

  return {
    fileName: fileResults.length === 1 ? fileResults[0].fileName : `${fileResults.length} files`,
    fileNames: fileResults.map((file) => file.fileName),
    files: fileResults.map((file) => ({
      fileName: file.fileName,
      characterCount: file.extractedText.length,
      extractedText: file.extractedText,
    })),
    characterCount: fileResults.reduce((total, file) => total + file.extractedText.length, 0),
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

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    requestId: req.requestId,
    nodeEnv: process.env.NODE_ENV || "development",
    renderService: process.env.RENDER_SERVICE_NAME || null,
    providers: {
      gemini: Boolean(
        String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim()
      ),
      cohere: Boolean(String(process.env.COHERE_API_KEY || "").trim()),
      huggingFace: Boolean(String(process.env.HUGGINGFACE_API_KEY || "").trim()),
    },
    firebase: {
      publicConfigured: hasPublicFirebaseConfig(),
      adminConfigured: hasAdminCredentials(),
    },
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
    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "upload_route_hit",
        userId: req.user?.uid || null,
        files: buildFileLog(req.files),
      })
    );
    const uploadResult = await extractTextFromFiles(req.files);
    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "upload_processed",
        fileName: uploadResult.fileName,
        fileCount: uploadResult.fileNames.length,
        characterCount: uploadResult.characterCount,
      })
    );
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
      files,
      summaryType = "short",
      language = "English",
    } = req.body;

    const normalizedSummaryType = normalizeSummaryType(summaryType);
    const normalizedLanguage = language && typeof language === "string" ? language.trim() : "English";
    const summaryTargets = Array.isArray(files) && files.length
      ? files
      : [{ fileName, extractedText: text }];

    if (!summaryTargets.length) {
      throw createHttpError(400, "No document text was provided for summarization.");
    }

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "summarize_route_hit",
        userId: req.user?.uid || null,
        fileName,
        summaryType,
        normalizedSummaryType,
        language: normalizedLanguage,
        fileCount: summaryTargets.length,
        textLength: typeof text === "string" ? text.length : null,
      })
    );
    const results = [];

    for (const target of summaryTargets) {
      const targetFileName = target?.fileName || DEFAULT_FILE_PLACEHOLDER;
      const targetText = typeof target?.extractedText === "string" ? target.extractedText : "";

      if (!targetText) {
        results.push({
          fileName: targetFileName,
          summaryType: normalizedSummaryType,
          status: "error",
          error: "No readable text was extracted for this file.",
        });
        continue;
      }

      try {
        const summary = await summarizeDocument(
          targetText,
          targetFileName,
          normalizedSummaryType,
          req.requestId,
          normalizedLanguage
        );
        const historyItem = req.user
          ? await saveSummaryToHistory({
              userId: req.user.uid,
              fileName: targetFileName,
              summary,
              summaryType: normalizedSummaryType,
            })
          : null;

        results.push({
          fileName: targetFileName,
          summaryType: normalizedSummaryType,
          summary,
          status: "success",
          historyItem,
        });
      } catch (error) {
        logServerError(error, req, `summarize_file:${targetFileName}`);
        results.push({
          fileName: targetFileName,
          summaryType: normalizedSummaryType,
          status: "error",
          error: error.message || "This file could not be summarized.",
        });
      }
    }

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "summarize_completed",
        fileCount: results.length,
        successCount: results.filter((result) => result.status === "success").length,
        errorCount: results.filter((result) => result.status === "error").length,
      })
    );

    res.json({ results });
  } catch (error) {
    logServerError(error, req, "summarize_route");
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
        error: "File is too large. Please upload documents smaller than 25 MB each.",
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
  const message = error.message || "Something went wrong while processing your request.";

  res.status(status).json({
    error: message,
    requestId: req?.requestId || null,
    details: error.details || null,
  });
});

process.on("uncaughtException", (error) => {
  logServerError(error, null, "uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logServerError(error, null, "unhandledRejection");
});

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      event: "server_listening",
      port: PORT,
      corsConfigured: allowedOrigins.length > 0,
      allowedOrigins,
    })
  );
});
