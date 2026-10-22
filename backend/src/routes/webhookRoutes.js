import express from "express";
import {
    angelOnePostback,
    angelOneImportCsv
} from "../controllers/webhookController.js";
import multer from "multer";

const router = express.Router();

// Multer config — store CSV/Excel in memory for quick parsing
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
    fileFilter: (_req, file, cb) => {
        const name = (file.originalname || "").toLowerCase();
        if (
            file.mimetype === "text/csv" ||
            file.mimetype === "application/vnd.ms-excel" ||
            file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            name.endsWith(".csv") ||
            name.endsWith(".xlsx") ||
            name.endsWith(".xls")
        ) {
            cb(null, true);
        } else {
            cb(new Error("Only CSV and Excel (.xlsx, .xls) files are allowed"), false);
        }
    }
});

// --------------------
// Angel One Postback (real-time trade capture)
// --------------------
// Configure this URL in your SmartAPI app settings:
//   https://your-domain.com/api/webhooks/angelone/postback
router.post("/angelone/postback", angelOnePostback);

// --------------------
// Angel One CSV Import (historical trade import)
// --------------------
// POST /api/webhooks/angelone/import-csv/:brokerAccountId
router.post(
    "/angelone/import-csv/:brokerAccountId",
    upload.single("file"),
    angelOneImportCsv
);

export default router;
