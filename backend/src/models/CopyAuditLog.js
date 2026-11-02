import mongoose from "mongoose";

const copyAuditLogSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        eventType: {
            type: String,
            required: true,
            enum: [
                "CONFIG_CHANGE",
                "MASTER_EVENT",
                "RISK_PASS",
                "RISK_REJECT",
                "SUBMISSION_SUCCESS",
                "SUBMISSION_FAIL",
                "ORDER_ACKNOWLEDGED",
                "PARTIAL_FILL",
                "FULL_FILL",
                "MODIFICATION",
                "CANCELLATION",
                "EMERGENCY_STOP",
                "PAUSE",
                "RECOVERY_ACTION",
                "DISCREPANCY",
                "SYSTEM_HEALTH"
            ],
            index: true
        },
        severity: {
            type: String,
            enum: ["INFO", "WARN", "ERROR", "CRITICAL"],
            default: "INFO",
            index: true
        },
        masterOrderId: {
            type: String,
            default: null,
            index: true
        },
        followerOrderId: {
            type: String,
            default: null,
            index: true
        },
        followerAccountId: {
            type: String,
            default: null
        },
        message: {
            type: String,
            required: true
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        latencyMs: {
            type: Number,
            default: null
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

copyAuditLogSchema.index({ userId: 1, createdAt: -1 });

const CopyAuditLog = mongoose.model("CopyAuditLog", copyAuditLogSchema);
export default CopyAuditLog;
