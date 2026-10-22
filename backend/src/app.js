import express from "express";
import cors from "cors";
import brokerAccountRoutes from "./routes/brokerAccountRoutes.js";
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "TradeGuard API is running"
    });
});

app.use(
    "/api/broker-accounts",
    brokerAccountRoutes
);

export default app;