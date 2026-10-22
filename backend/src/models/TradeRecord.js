import mongoose from "mongoose";

const tradeRecordSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        brokerAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BrokerAccount",
            required: true
        },

        broker: {
            type: String,
            enum: [
                "UPSTOX",
                "ANGEL_ONE",
                "DHAN"
            ],
            required: true
        },

        // Broker's unique trade/execution ID.
        // Example: Upstox historical trade_id.
        tradeId: {
            type: String,
            required: true
        },

        // Order ID is optional because some broker
        // historical-trade APIs don't provide it.
        orderId: {
            type: String,
            default: null
        },

        symbol: {
            type: String,
            required: true
        },

        exchange: {
            type: String
        },

        segment: {
            type: String,
            enum: [
                "EQUITY",
                "FUTURES",
                "OPTIONS"
            ]
        },

        transactionType: {
            type: String,
            enum: ["BUY", "SELL"],
            required: true
        },

        quantity: {
            type: Number,
            required: true
        },

        executedPrice: {
            type: Number,
            required: true
        },

        orderType: {
            type: String,
            enum: [
                "MARKET",
                "LIMIT",
                "SL",
                "SL-M"
            ]
        },

        status: {
            type: String,
            enum: [
                "PENDING",
                "TRANSIT",
                "COMPLETE",
                "CANCELLED",
                "REJECTED",
                "FAILED"
            ]
        },

        productCode: {
            type: String
        },

        tradeTime: {
            type: Date
        },

        brokerResponse: {
            type: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);


// Prevent duplicate trades for the same broker account.
tradeRecordSchema.index(
    {
        brokerAccountId: 1,
        tradeId: 1
    },
    {
        unique: true
    }
);


const TradeRecord =
    mongoose.model(
        "TradeRecord",
        tradeRecordSchema
    );

export default TradeRecord;