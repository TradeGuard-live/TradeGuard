import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { authenticate } from "../middleware/auth.js";
import {
  listJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getJournalAnalytics,
  getJournalStrategies,
  handleJournalUpload
} from "../controllers/journalController.js";

const router = express.Router();

// ✅ Resolve local directory for uploaded screenshots and attachments
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../../uploads/journal");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ✅ Secure Multer configuration with disk storage, size limit (5MB), and mime-type validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${cleanName}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/svg+xml",
    "application/pdf"
  ];
  if (allowedTypes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error("Only images (PNG, JPG, WEBP, SVG) and PDF documents are allowed"), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter
});

// ✅ Routes with JWT authentication
router.get("/analytics", authenticate, getJournalAnalytics);
router.get("/strategies", authenticate, getJournalStrategies);
router.get("/", authenticate, listJournalEntries);
router.get("/:id", authenticate, getJournalEntry);
router.post("/", authenticate, createJournalEntry);
router.put("/:id", authenticate, updateJournalEntry);
router.delete("/:id", authenticate, deleteJournalEntry);

// ✅ File upload route
router.post(
  "/upload",
  authenticate,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  },
  handleJournalUpload
);

export default router;

