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
const nodemailer = require("nodemailer");
const { FieldValue } = require("firebase-admin/firestore");
const {
  getFirebaseAuth,
  getFirebaseDb,
  getPublicFirebaseConfig,
  hasAdminCredentials,
  hasPublicFirebaseConfig,
} = require("./firebaseAdmin");
const geminiProvider = require("./providers/gemini");
const {
  summarizeDocument,
  normalizeSummaryType,
} = require("./services/summarizerService");
const {
  encrypt,
  decrypt,
} = require("./utils/encryption");

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
    encryptionSecretConfigured: Boolean(
      process.env.GEMINI_KEY_ENCRYPTION_SECRET && 
      process.env.GEMINI_KEY_ENCRYPTION_SECRET !== "your_encryption_secret_here"
    ),
  })
);

const geminiKeyRaw = String(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ""
).trim();
const geminiKeyNormalized = geminiKeyRaw.replace(/^["']|["']$/g, "");
const geminiKeyPresent = Boolean(geminiKeyNormalized && geminiKeyNormalized !== "your_key_here");

// No prefix-based format check: Google issues valid Gemini API keys in
// multiple formats ('AIza...' legacy and 'AQ....' newer AI Studio keys).
// Actual validity is proven by real API calls at request time.

console.log(
  JSON.stringify({
    event: "gemini_key_validation",
    keyPresent: geminiKeyPresent,
    keyLength: geminiKeyNormalized.length,
    hint: !geminiKeyPresent
      ? "GEMINI_API_KEY is missing from environment. Get a key from https://aistudio.google.com/apikey"
      : "GEMINI_API_KEY is configured.",
  })
);

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_COMBINED_TEXT_LENGTH = 18000;
const HISTORY_LIMIT = 30;
const FREE_SUMMARY_DAILY_LIMIT = 6;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getDailyUsageStart() {
  const todayKey = new Date().toISOString().slice(0, 10);
  return new Date(`${todayKey}T00:00:00.000Z`);
}

async function getRemainingDailySummaries(userId) {
  const db = getFirebaseDb();
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("summaries")
    .where("createdAt", ">=", getDailyUsageStart())
    .get();

  return Math.max(FREE_SUMMARY_DAILY_LIMIT - snapshot.size, 0);
}

async function getUserGeminiApiKey(userId) {
  try {
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(userId).get();
    
    if (!userDoc.exists || !userDoc.data().geminiApiKey) {
      return null;
    }

    const encryptedKey = userDoc.data().geminiApiKey;
    
    try {
      return decrypt(encryptedKey);
    } catch (decryptionError) {
      console.error(
        JSON.stringify({
          event: "byok_key_decryption_failed",
          userId,
          error: decryptionError.message,
        })
      );
      // If decryption fails, the key might be corrupted or encryption secret changed
      // Return null to fall back to default key
      return null;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "byok_key_retrieval_failed",
        userId,
        error: error.message,
      })
    );
    return null;
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

async function validateGeminiApiKey(apiKey, requestId) {
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorBody = null;

      try {
        errorBody = errorText ? JSON.parse(errorText) : null;
      } catch {
        errorBody = null;
      }

      const diagnostics = {
        requestId,
        event: "gemini_key_validation_failed",
        status: response.status,
        statusText: response.statusText,
        errorCode: errorBody?.error?.status || null,
        errorMessage: errorBody?.error?.message
          ? String(errorBody.error.message).slice(0, 300)
          : null,
        errorReason: errorBody?.error?.details?.[0]?.reason || null,
        errorDetailMessage: errorBody?.error?.details?.[0]?.message
          ? String(errorBody.error.details[0].message).slice(0, 300)
          : null,
      };

      console.error(JSON.stringify(diagnostics));

      return {
        valid: false,
        status: response.status,
        errorCode: errorBody?.error?.status || null,
        errorReason: errorBody?.error?.details?.[0]?.reason || null,
        errorMessage: errorBody?.error?.message || null,
      };
    }

    return { valid: true };
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(
        JSON.stringify({
          requestId,
          event: "gemini_key_validation_timeout",
        })
      );
      return { valid: false, status: 0, errorCode: "timeout", errorMessage: null };
    }

    console.error(
      JSON.stringify({
        requestId,
        event: "gemini_key_validation_error",
        error: error.message,
      })
    );
    return { valid: false, status: 0, errorCode: "network_error", errorMessage: null };
  }
}

function describeGeminiKeyValidationFailure(validation) {
  const reason = String(validation.errorReason || "").toLowerCase();
  const code = String(validation.errorCode || "").toLowerCase();
  const message = String(validation.errorMessage || "").toLowerCase();

  if (validation.status === 401 || code === "unauthenticated") {
    return "Google rejected this API key. Please double-check the key you pasted from https://aistudio.google.com/apikey and try again.";
  }

  if (code === "timeout") {
    return "Validating this key took too long. Check your connection and try again.";
  }

  if (
    validation.status === 400 &&
    (code === "invalid_argument" ||
      message.includes("api key") ||
      reason.includes("api key") ||
      reason.includes("service_disabled") ||
      reason.includes("api_key_service_blocked"))
  ) {
    if (reason.includes("service_disabled") || reason.includes("api_key_service_blocked")) {
      return "The Generative Language API is not enabled for the Google project that owns this API key. Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com then reconnect.";
    }
    return "Google rejected this API key. Please double-check the key you pasted from https://aistudio.google.com/apikey and try again.";
  }

  if (
    validation.status === 403 ||
    code === "permission_denied" ||
    reason.includes("service_disabled") ||
    reason.includes("api_key_service_blocked")
  ) {
    if (reason.includes("service_disabled") || reason.includes("api_key_service_blocked")) {
      return "The Generative Language API is not enabled for the Google project that owns this API key. Enable it at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com then reconnect.";
    }

    return "This API key is not allowed to use the Generative Language API. Check the key's restrictions in Google AI Studio or Cloud Console, then try again.";
  }

  if (validation.status === 429 || code === "resource_exhausted") {
    return "This API key has reached its quota or rate limit. Wait a moment in Google AI Studio, then try connecting again.";
  }

  if (validation.status === 0) {
    return "Could not reach Google to verify this API key. Check your connection and try again.";
  }

  if (validation.status >= 500) {
    return "Google's servers returned an error while verifying this key. Please try again in a moment.";
  }

  if (validation.status === 400) {
    return "Google rejected this API key. Please double-check the key you pasted from https://aistudio.google.com/apikey and try again.";
  }

  return "We couldn't connect this Gemini API key. Please check your key and try again.";
}

app.post("/api/settings/gemini-key", attachOptionalUser, async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw createHttpError(400, "API key is required.");
    }

    const normalizedKey = apiKey.trim().replace(/^["']|["']$/g, "");

    // No prefix-based rejection: Google issues valid Gemini keys in multiple
    // formats ('AIza...' legacy and 'AQ....' newer AI Studio keys). Validity
    // is decided solely by the real Gemini API call below.

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "byok_validation_started",
        userId: req.user?.uid || null,
        keyLength: normalizedKey.length,
      })
    );

    const validation = await validateGeminiApiKey(normalizedKey, req.requestId);

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "byok_validation_result",
        valid: validation.valid,
        status: validation.status || null,
        errorCode: validation.errorCode || null,
        errorReason: validation.errorReason || null,
        errorMessage: validation.errorMessage
          ? String(validation.errorMessage).slice(0, 300)
          : null,
      })
    );

    if (!validation.valid) {
      throw createHttpError(400, describeGeminiKeyValidationFailure(validation));
    }

    // For authenticated users, persist the encrypted key in Firestore so it
    // survives page reloads and is available across sessions.  Unauthenticated
    // users can still validate & use their key for the current session — the
    // frontend stores it in sessionStorage.
    if (req.user) {
      let encryptedKey;
      try {
        encryptedKey = encrypt(normalizedKey);
      } catch (encryptionError) {
        console.error(
          JSON.stringify({
            requestId: req.requestId,
            event: "byok_encryption_failed",
            error: encryptionError.message,
          })
        );
        throw createHttpError(500, "Server encryption configuration is incomplete. Please contact the administrator.");
      }

      const db = getFirebaseDb();
      
      await db
        .collection("users")
        .doc(req.user.uid)
        .set(
          {
            geminiApiKey: encryptedKey,
            geminiProvider: "gemini",
            updatedAt: new Date(),
          },
          { merge: true }
        );

      console.log(
        JSON.stringify({
          requestId: req.requestId,
          event: "byok_key_saved",
          userId: req.user.uid,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          requestId: req.requestId,
          event: "byok_key_validated_guest",
          keyLength: normalizedKey.length,
        })
      );
    }

    res.json({
      success: true,
      message: "Gemini API key connected. Your future AI requests will use your own Gemini API quota.",
    });
  } catch (error) {
    logServerError(error, req, "byok_save");
    next(error);
  }
});

app.get("/api/settings/gemini-key", requireAuth, async (req, res, next) => {
  try {
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(req.user.uid).get();
    
    if (!userDoc.exists || !userDoc.data().geminiApiKey) {
      res.json({
        connected: false,
        provider: null,
      });
      return;
    }

    res.json({
      connected: true,
      provider: "gemini",
    });
  } catch (error) {
    logServerError(error, req, "byok_get");
    next(error);
  }
});

app.delete("/api/settings/gemini-key", requireAuth, async (req, res, next) => {
  try {
    const db = getFirebaseDb();

    // set + merge with FieldValue.delete() is idempotent: it works whether or
    // not the user document/fields exist, and removes the fields entirely
    // instead of leaving null tombstones behind.
    await db
      .collection("users")
      .doc(req.user.uid)
      .set(
        {
          geminiApiKey: FieldValue.delete(),
          geminiProvider: FieldValue.delete(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "byok_key_deleted",
        userId: req.user.uid,
      })
    );

    res.json({
      success: true,
      message: "Gemini API key disconnected. Your requests will use the app's free plan again.",
    });
  } catch (error) {
    logServerError(error, req, "byok_delete");
    next(error);
  }
});

/* ---------------- Contact form ---------------- */

// No application-level submission limit: legitimate users can send as many
// messages as they need. Abuse protection is limited to the honeypot field
// and input validation below. Any real quota is the email provider's own
// (e.g. Gmail SMTP sending limits), which surfaces as a handled error.

function getContactTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  const port = Number(SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

function isValidContactEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

app.post("/api/contact", async (req, res, next) => {
  try {
    // Honeypot: real users never see or fill the "website" field. Bots that do
    // are silently dropped with a fake-success response.
    if (typeof req.body?.website === "string" && req.body.website.trim()) {
      console.log(
        JSON.stringify({
          requestId: req.requestId,
          event: "contact_honeypot_triggered",
        })
      );
      res.json({ ok: true, message: "Thanks! Your message has been sent." });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!name || name.length > 120) {
      throw createHttpError(400, "Please enter your name (max 120 characters).");
    }

    if (!email || email.length > 254 || !isValidContactEmail(email)) {
      throw createHttpError(400, "Please enter a valid email address.");
    }

    if (!message || message.length > 5000) {
      throw createHttpError(400, "Please enter a message (max 5000 characters).");
    }

    const transporter = getContactTransporter();
    if (!transporter) {
      // Server configuration issue, not a user problem: report it honestly.
      console.error(
        JSON.stringify({
          requestId: req.requestId,
          event: "contact_smtp_not_configured",
        })
      );
      throw createHttpError(
        503,
        "The contact form is not available right now. Please try again later."
      );
    }

    const recipient = String(process.env.CONTACT_TO || "aidocsummarizer@gmail.com");

    try {
      await transporter.sendMail({
        from: `"Document Summarizer Contact" <${process.env.CONTACT_FROM || process.env.SMTP_USER}>`,
        to: recipient,
        replyTo: email,
        subject: `New contact form message from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><hr><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
      });
    } catch (mailError) {
      // Provider rejected/failed the send. Log the technical details
      // server-side only; the user gets a clean, honest failure message.
      console.error(
        JSON.stringify({
          requestId: req.requestId,
          event: "contact_send_failed",
          errorCode: mailError.code || null,
          smtpResponse:
            typeof mailError.responseCode === "number" ? mailError.responseCode : null,
          errorMessage: String(mailError.message || "").slice(0, 300),
        })
      );
      throw createHttpError(
        502,
        "Your message couldn't be sent right now. Please try again in a moment."
      );
    }

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "contact_message_sent",
        recipient,
      })
    );

    res.json({ ok: true, message: "Thanks! Your message has been sent." });
  } catch (error) {
    logServerError(error, req, "contact_route");
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

    const requestedSummaryCount = summaryTargets.filter(
      (target) => typeof target?.extractedText === "string" && target.extractedText.trim()
    ).length;

    const storedUserKey = req.user ? await getUserGeminiApiKey(req.user.uid) : null;
    // Unauthenticated guests may supply their own Gemini key in the request
    // body (stored in sessionStorage on the client after validation).
    const clientSuppliedKey = !storedUserKey && req.body?.apiKey
      ? String(req.body.apiKey).trim().replace(/^["']|["']$/g, "")
      : null;
    const userKey = storedUserKey || clientSuppliedKey;
    const usingByok = Boolean(userKey);
    const geminiApiKey = userKey || geminiKeyNormalized;

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        event: "key_source_determined",
        usingByok,
        keySource: usingByok ? "user" : "application",
      })
    );

    if (req.user && requestedSummaryCount > 0 && !usingByok) {
      const remainingSummaries = await getRemainingDailySummaries(req.user.uid);

      if (remainingSummaries <= 0) {
        throw createHttpError(
          429,
          "You've reached today's free limit. Come back tomorrow or use your own Gemini API key."
        );
      }

      if (requestedSummaryCount > remainingSummaries) {
        throw createHttpError(
          429,
          `You have ${remainingSummaries} summar${remainingSummaries === 1 ? "y" : "ies"} remaining today. Select fewer files or try again tomorrow.`
        );
      }
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
        usingByok,
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
          normalizedLanguage,
          // Only a genuine user BYOK key is passed as customApiKey. The
          // application key is resolved inside the provider chain so the
          // default path keeps its multi-provider fallback behavior.
          usingByok ? userKey : null
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
        usingByok,
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
