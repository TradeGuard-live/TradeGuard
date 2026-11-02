import mongoose from "mongoose";

const followerSchema = new mongoose.Schema(
    {
        followerAccountId: {
            type: mongoose.Schema.Types.Mixed, // ObjectId string or "MOCK_FOLLOWER_X"
            required: true
        },
        followerBroker: {
            type: String,
            required: true,
            enum: ["UPSTOX", "ZERODHA", "ANGEL_ONE", "DHAN", "KOTAK_NEO", "GROWW", "MOCK"]
        },
        followerName: {
            type: String,
            default: "Follower Account"
        },
        isEnabled: {
            type: Boolean,
            default: true
        },
        isPaused: {
            type: Boolean,
            default: false
        },
        sizingMode: {
            type: String,
            enum: ["MULTIPLIER", "FIXED_QUANTITY", "LOT_PROPORTIONAL"],
            default: "MULTIPLIER"
        },
        multiplier: {
            type: Number,
            default: 1.0,
            min: 0.01,
            max: 100.0
        },
        fixedQuantity: {
            type: Number,
            default: 1,
            min: 1
        },
        maxOrderQuantity: {
            type: Number,
            default: 1800 // Default safe max cap for Nifty/BankNifty/Equity
        },
        maxOrderNotional: {
            type: Number,
            default: 500000 // ₹5,00,000 maximum per order
        },
        allowedSegments: {
            type: [String],
            default: ["EQUITY", "FUTURES", "OPTIONS"]
        },
        allowedProducts: {
            type: [String],
            default: ["INTRADAY", "DELIVERY", "NORMAL", "MIS", "CNC", "NRML"]
        },
        allowedOrderTypes: {
            type: [String],
            default: ["MARKET", "LIMIT", "SL", "SL-M"]
        },
        copyNewOrders: {
            type: Boolean,
            default: true
        },
        copyModifications: {
            type: Boolean,
            default: true
        },
        copyCancellations: {
            type: Boolean,
            default: true
        },
        pauseOnFailure: {
            type: Boolean,
            default: true
        },
        roundingRule: {
            type: String,
            enum: ["ROUND_DOWN", "ROUND_UP", "ROUND_NEAREST"],
            default: "ROUND_DOWN" // Fail-safe default
        }
    },
    { _id: true }
);

const copyConfigSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
            index: true
        },
        isEnabled: {
            type: Boolean,
            default: false
        },
        isPaused: {
            type: Boolean,
            default: false
        },
        emergencyStop: {
            type: Boolean,
            default: false
        },
        emergencyStopReason: {
            type: String,
            default: null
        },
        emergencyStopTriggeredAt: {
            type: Date,
            default: null
        },
        masterAccountId: {
            type: mongoose.Schema.Types.Mixed, // ObjectId string or "MOCK_MASTER"
            default: null
        },
        masterBroker: {
            type: String,
            enum: ["UPSTOX", "ZERODHA", "ANGEL_ONE", "DHAN", "KOTAK_NEO", "GROWW", "MOCK"],
            default: "MOCK"
        },
        followers: [followerSchema],
        riskLimits: {
            maxDailyOrders: {
                type: Number,
                default: 500
            },
            maxOrdersPerSecond: {
                type: Number,
                default: 10
            },
            maxOpenUnresolvedOperations: {
                type: Number,
                default: 20
            },
            dailyMaxLoss: {
                type: Number,
                default: 50000
            },
            requireStrictInstrumentMatch: {
                type: Boolean,
                default: true
            },
            cancelOpenOnEmergencyStop: {
                type: Boolean,
                default: false
            }
        }
    },
    {
        timestamps: true
    }
);

const CopyConfig = mongoose.model("CopyConfig", copyConfigSchema);
export default CopyConfig;
