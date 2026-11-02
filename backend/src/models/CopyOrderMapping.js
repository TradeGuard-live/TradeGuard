import mongoose from "mongoose";

const copyOrderMappingSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        copyConfigId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CopyConfig",
            required: true
        },
        idempotencyKey: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        masterAccountId: {
            type: String,
            required: true,
            index: true
        },
        masterBroker: {
            type: String,
            required: true
        },
        masterOrderId: {
            type: String,
            required: true,
            index: true
        },
        masterOrderStatus: {
            type: String,
            default: "PENDING"
        },
        sourceEventId: {
            type: String,
            default: null
        },
        eventVersion: {
            type: Number,
            default: 1
        },

        // Instrument details
        symbol: {
            type: String,
            required: true
        },
        exchange: {
            type: String,
            default: "NSE"
        },
        segment: {
            type: String,
            enum: ["EQUITY", "FUTURES", "OPTIONS"],
            default: "EQUITY"
        },
        transactionType: {
            type: String,
            enum: ["BUY", "SELL"],
            required: true
        },
        orderType: {
            type: String,
            enum: ["MARKET", "LIMIT", "SL", "SL-M"],
            default: "MARKET"
        },
        productCode: {
            type: String,
            default: "INTRADAY"
        },

        // Master order metrics
        masterPrice: {
            type: Number,
            default: 0
        },
        masterTriggerPrice: {
            type: Number,
            default: 0
        },
        masterQuantity: {
            type: Number,
            required: true
        },
        masterFilledQuantity: {
            type: Number,
            default: 0
        },

        // Follower target details
        followerAccountId: {
            type: String,
            required: true,
            index: true
        },
        followerBroker: {
            type: String,
            required: true
        },
        followerOrderId: {
            type: String,
            default: null,
            index: true
        },
        requestedOperation: {
            type: String,
            enum: ["PLACE", "MODIFY", "CANCEL"],
            required: true
        },
        followerStatus: {
            type: String,
            enum: [
                "PENDING",
                "SUBMITTED",
                "ACKNOWLEDGED",
                "PARTIALLY_FILLED",
                "FILLED",
                "REJECTED",
                "CANCELLED",
                "FAILED",
                "UNKNOWN"
            ],
            default: "PENDING",
            index: true
        },
        followerQuantity: {
            type: Number,
            required: true
        },
        followerFilledQuantity: {
            type: Number,
            default: 0
        },
        followerRemainingQuantity: {
            type: Number,
            default: 0
        },
        followerAveragePrice: {
            type: Number,
            default: 0
        },
        rejectionReason: {
            type: String,
            default: null
        },
        errorMessage: {
            type: String,
            default: null
        },

        // Latency & Monotonic Timers
        timing: {
            masterEventReceivedAt: { type: Date, default: null },
            riskValidatedAt: { type: Date, default: null },
            submittedAt: { type: Date, default: null },
            acknowledgedAt: { type: Date, default: null },
            finalStateAt: { type: Date, default: null },
            latencyMs: { type: Number, default: 0 },          // Receipt -> Submission
            totalAckLatencyMs: { type: Number, default: 0 }  // Receipt -> Acknowledgment
        },

        // Reconciliation
        reconciliation: {
            isReconciled: { type: Boolean, default: false },
            reconciledAt: { type: Date, default: null },
            discrepancy: { type: String, default: null }
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for rapid lookups and synchronization queries
copyOrderMappingSchema.index({ masterOrderId: 1, followerAccountId: 1 });
copyOrderMappingSchema.index({ userId: 1, createdAt: -1 });
copyOrderMappingSchema.index({ followerStatus: 1, createdAt: -1 });

const CopyOrderMapping = mongoose.model("CopyOrderMapping", copyOrderMappingSchema);
export default CopyOrderMapping;
