import mongoose from "mongoose";
import { encrypt } from "../utils/encryption.js";

const brokerAccountSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        broker: {
            type: String,
            enum: ["UPSTOX", "ANGEL_ONE", "DHAN"],
            required: true
        },

        credentials: {
            clientId: {
                type: String,
                required: true
            },

            apiKey: String,
            apiSecret: String,
            accessToken: String,
            refreshToken: String,
            password: String,
            totpSecret: String,
            feedToken: String,

            tokenExpiresAt: Date
        },

        isConnected: {
            type: Boolean,
            default: false
        },

        isActive: {
            type: Boolean,
            default: true
        },

        lastConnectedAt: Date
    },
    {
        timestamps: true
    }
);


// Encrypt sensitive broker credentials before saving
brokerAccountSchema.pre("save", function () {

    if (this.isModified("credentials.apiKey") && this.credentials.apiKey) {
        this.credentials.apiKey = encrypt(this.credentials.apiKey);
    }

    if (this.isModified("credentials.apiSecret") && this.credentials.apiSecret) {
        this.credentials.apiSecret = encrypt(this.credentials.apiSecret);
    }

    if (this.isModified("credentials.accessToken") && this.credentials.accessToken) {
        this.credentials.accessToken = encrypt(this.credentials.accessToken);
    }

    if (this.isModified("credentials.refreshToken") && this.credentials.refreshToken) {
        this.credentials.refreshToken = encrypt(this.credentials.refreshToken);
    }

    if (this.isModified("credentials.password") && this.credentials.password) {
        this.credentials.password = encrypt(this.credentials.password);
    }

    if (this.isModified("credentials.totpSecret") && this.credentials.totpSecret) {
        this.credentials.totpSecret = encrypt(this.credentials.totpSecret);
    }

    if (this.isModified("credentials.feedToken") && this.credentials.feedToken) {
        this.credentials.feedToken = encrypt(this.credentials.feedToken);
    }

});


// One broker account per broker for each user
brokerAccountSchema.index(
    { userId: 1, broker: 1 },
    { unique: true }
);


const BrokerAccount = mongoose.model(
    "BrokerAccount",
    brokerAccountSchema
);

export default BrokerAccount;