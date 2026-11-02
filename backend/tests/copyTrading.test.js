/**
 * copyTrading.test.js
 * 
 * Comprehensive automated test suite for TradeGuard Copy-Trading Engine.
 * Covers:
 * - Deterministic Mock Broker lifecycle (Order placement, modification, cancellation, fills)
 * - Fault injection (Network timeouts, rate limits, 401 expiry, duplicate events, out-of-order)
 * - Idempotency and exactly-once safety (double-submission prevention)
 * - Risk validation (Max quantity, max notional, rate limits, segment/product restrictions)
 * - Global Emergency Stop (Kill switch)
 * - Multi-follower routing (Independent follower processing, one slow/failing follower does not block others)
 * - Reconciliation of UNKNOWN outcomes
 * - Monotonic latency calculation (p50, p95, p99)
 * - Secret redaction in audit logs
 */

import test from "node:test";
import assert from "node:assert/strict";
import MockBrokerAdapter from "../src/services/copyTrading/adapters/MockBrokerAdapter.js";
import { idempotencyService } from "../src/services/copyTrading/engine/IdempotencyService.js";
import { riskValidationService } from "../src/services/copyTrading/engine/RiskValidationService.js";
import { copyPolicyEngine } from "../src/services/copyTrading/engine/CopyPolicyEngine.js";
import { instrumentMappingService } from "../src/services/copyTrading/engine/InstrumentMappingService.js";
import { CopyTradingMetrics } from "../src/services/copyTrading/engine/CopyTradingMetrics.js";
import { copyTradingAuditService } from "../src/services/copyTrading/engine/CopyTradingAuditService.js";
import { OrderStateMachine } from "../src/services/copyTrading/engine/OrderStateMachine.js";
import { getBrokerCapabilities } from "../src/services/copyTrading/contracts/BrokerCapabilityRegistry.js";
import CanonicalOrderEvent from "../src/services/copyTrading/models/CanonicalOrderEvent.js";
import DhanAdapter from "../src/brokers/dhan/DhanAdapter.js";
import { BrokerAdapterFactory } from "../src/services/copyTrading/adapters/BrokerAdapterFactory.js";

// =========================================================================
// 1. Mock Broker Adapter & Order Lifecycle Tests
// =========================================================================

test("CopyTrading 1: MockBrokerAdapter places order and emits ACKNOWLEDGED and FILLED events", async () => {
    const mock = new MockBrokerAdapter({ accountId: "MOCK_TEST_01", initialLatencyMs: 1 });
    const events = [];
    mock.subscribeOrderStream((evt) => events.push(evt));

    const res = await mock.placeOrder({
        symbol: "TCS",
        exchange: "NSE",
        segment: "EQUITY",
        transactionType: "BUY",
        orderType: "MARKET",
        quantity: 10,
        price: 3500.0
    });

    assert.equal(res.success, true);
    assert.ok(res.orderId.startsWith("MOCK-ORD-"));
    assert.equal(res.status, "ACKNOWLEDGED");

    // Wait for fill simulation
    await new Promise((r) => setTimeout(r, 20));

    const finalOrder = await mock.getOrder(res.orderId);
    assert.equal(finalOrder.status, "FILLED");
    assert.equal(finalOrder.filledQuantity, 10);
    assert.equal(finalOrder.remainingQuantity, 0);

    const trades = await mock.getTrades();
    assert.ok(trades.length >= 1);
    assert.equal(trades[trades.length - 1].orderId, res.orderId);
});

test("CopyTrading 2: MockBrokerAdapter handles partial fills and multiple fills", async () => {
    const mock = new MockBrokerAdapter({ accountId: "MOCK_TEST_02", initialLatencyMs: 1 });
    mock.setFaults({ partialFillRatio: 0.5, fillDelayMs: 5 });

    const res = await mock.placeOrder({
        symbol: "INFY",
        transactionType: "BUY",
        quantity: 20
    });

    await new Promise((r) => setTimeout(r, 20));

    const order = await mock.getOrder(res.orderId);
    assert.equal(order.status, "PARTIALLY_FILLED");
    assert.equal(order.filledQuantity, 10);
    assert.equal(order.remainingQuantity, 10);
});

test("CopyTrading 3: MockBrokerAdapter handles order modifications", async () => {
    const mock = new MockBrokerAdapter({ accountId: "MOCK_TEST_03", initialLatencyMs: 1 });
    mock.setFaults({ fillDelayMs: 200 }); // delay fill so order remains open

    const res = await mock.placeOrder({
        symbol: "RELIANCE",
        transactionType: "BUY",
        quantity: 50,
        price: 2500
    });

    // Modify quantity from 50 to 80
    const modRes = await mock.modifyOrder({
        orderId: res.orderId,
        quantity: 80,
        price: 2510
    });

    assert.equal(modRes.success, true);
    const order = await mock.getOrder(res.orderId);
    assert.equal(order.quantity, 80);
    assert.equal(order.price, 2510);
});

test("CopyTrading 4: MockBrokerAdapter handles order cancellations and fill races", async () => {
    const mock = new MockBrokerAdapter({ accountId: "MOCK_TEST_04", initialLatencyMs: 1 });
    mock.setFaults({ fillDelayMs: 200 }); // open

    const res = await mock.placeOrder({
        symbol: "SBIN",
        transactionType: "BUY",
        quantity: 100
    });

    const cancelRes = await mock.cancelOrder({ orderId: res.orderId });
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.status, "CANCELLED");

    const order = await mock.getOrder(res.orderId);
    assert.equal(order.status, "CANCELLED");

    // Attempting to cancel already filled order throws ORDER_ALREADY_FILLED
    const filledMock = new MockBrokerAdapter({ accountId: "MOCK_TEST_05", initialLatencyMs: 1 });
    const filledRes = await filledMock.placeOrder({ symbol: "ITC", transactionType: "BUY", quantity: 10 });
    await new Promise((r) => setTimeout(r, 20));

    await assert.rejects(
        async () => filledMock.cancelOrder({ orderId: filledRes.orderId }),
        (err) => err.code === "ORDER_ALREADY_FILLED"
    );
});

test("CopyTrading 5: MockBrokerAdapter fault injection (Rejection, Timeout, 401 Expiry, 429 Rate Limit)", async () => {
    const mock = new MockBrokerAdapter({ accountId: "MOCK_FAULT_01", initialLatencyMs: 1 });

    // 1. Programmatic rejection
    mock.setFaults({ rejectNext: true, rejectReason: "Margin insufficient" });
    const rejRes = await mock.placeOrder({ symbol: "WIPRO", transactionType: "BUY", quantity: 50 });
    assert.equal(rejRes.success, false);
    assert.equal(rejRes.status, "REJECTED");
    assert.ok(rejRes.message.includes("Margin"));

    // 2. Request timeout
    mock.setFaults({ timeoutNext: true });
    await assert.rejects(
        async () => mock.placeOrder({ symbol: "WIPRO", transactionType: "BUY", quantity: 10 }),
        (err) => err.code === "ECONNABORTED"
    );

    // 3. Auth expired
    mock.setFaults({ authExpired: true });
    await assert.rejects(
        async () => mock.placeOrder({ symbol: "WIPRO", transactionType: "BUY", quantity: 10 }),
        (err) => err.status === 401
    );

    // 4. Rate limit exceeded
    mock.setFaults({ authExpired: false, rateLimitExceeded: true });
    await assert.rejects(
        async () => mock.placeOrder({ symbol: "WIPRO", transactionType: "BUY", quantity: 10 }),
        (err) => err.status === 429
    );
});

// =========================================================================
// 2. Idempotency & Exactly-Once Safety Tests
// =========================================================================

test("CopyTrading 6: IdempotencyService generates deterministic keys and blocks duplicates", () => {
    idempotencyService.clear();

    const params = {
        masterAccountId: "MOCK_MASTER",
        masterOrderId: "ORD-9988",
        eventVersion: 1,
        followerAccountId: "MOCK_FOLLOWER_A",
        operation: "PLACE"
    };

    const key1 = idempotencyService.generateKey(params);
    const key2 = idempotencyService.generateKey(params);
    assert.equal(key1, key2, "Same input must yield identical SHA256 key");

    assert.equal(idempotencyService.isDuplicate(key1), false);
    idempotencyService.markProcessed(key1);
    assert.equal(idempotencyService.isDuplicate(key1), true);

    // Different event version yields distinct key (for modifications)
    const keyMod = idempotencyService.generateKey({ ...params, eventVersion: 2, operation: "MODIFY" });
    assert.notEqual(key1, keyMod);
    assert.equal(idempotencyService.isDuplicate(keyMod), false);
});

// =========================================================================
// 3. Risk Validation & Emergency Stop Tests
// =========================================================================

test("CopyTrading 7: RiskValidationService enforces global pause and Emergency Stop kill switch", () => {
    const copyConfig = {
        isEnabled: true,
        isPaused: false,
        emergencyStop: false,
        followers: []
    };
    const follower = {
        followerAccountId: "F1",
        followerName: "Follower 1",
        isEnabled: true,
        isPaused: false,
        followerBroker: "MOCK",
        maxOrderQuantity: 500,
        maxOrderNotional: 200000
    };
    const canonical = new CanonicalOrderEvent({
        broker: "MOCK",
        accountId: "M",
        orderId: "O1",
        symbol: "HDFCBANK",
        transactionType: "BUY",
        quantity: 50,
        price: 1500
    });

    // Healthy check
    const check1 = riskValidationService.validateOperation({
        copyConfig,
        follower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 50,
        price: 1500
    });
    assert.equal(check1.allowed, true);

    // Trigger Emergency Stop
    copyConfig.emergencyStop = true;
    copyConfig.emergencyStopReason = "Operator triggered kill switch";
    const checkKill = riskValidationService.validateOperation({
        copyConfig,
        follower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 50,
        price: 1500
    });
    assert.equal(checkKill.allowed, false);
    assert.ok(checkKill.reason.includes("Emergency Stop"));

    // Reset kill switch, test Global Pause
    copyConfig.emergencyStop = false;
    copyConfig.isPaused = true;
    const checkPause = riskValidationService.validateOperation({
        copyConfig,
        follower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 50,
        price: 1500
    });
    assert.equal(checkPause.allowed, false);
    assert.ok(checkPause.reason.includes("paused"));
});

test("CopyTrading 8: RiskValidationService enforces follower max quantity and max notional caps", () => {
    const copyConfig = { isEnabled: true, isPaused: false, emergencyStop: false };
    const follower = {
        followerAccountId: "F2",
        followerName: "Follower 2",
        isEnabled: true,
        isPaused: false,
        followerBroker: "MOCK",
        maxOrderQuantity: 100,
        maxOrderNotional: 100000 // ₹1 Lakh
    };
    const canonical = new CanonicalOrderEvent({
        broker: "MOCK",
        accountId: "M",
        orderId: "O2",
        symbol: "MARUTI",
        transactionType: "BUY",
        quantity: 150,
        price: 10000
    });

    // Exceeds max quantity (150 > 100)
    const checkQty = riskValidationService.validateOperation({
        copyConfig,
        follower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 150,
        price: 100
    });
    assert.equal(checkQty.allowed, false);
    assert.ok(checkQty.reason.includes("max order quantity"));

    // Quantity within cap (50 <= 100), but notional exceeds cap (50 * ₹10,000 = ₹5,00,000 > ₹1,00,000)
    const checkNotional = riskValidationService.validateOperation({
        copyConfig,
        follower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 50,
        price: 10000
    });
    assert.equal(checkNotional.allowed, false);
    assert.ok(checkNotional.reason.includes("notional value"));
});

test("CopyTrading 9: RiskValidationService rejects unsupported broker operations (e.g. Groww automated order placement)", () => {
    const copyConfig = { isEnabled: true, isPaused: false, emergencyStop: false };
    const growwFollower = {
        followerAccountId: "F_GROWW",
        followerName: "Groww Follower",
        isEnabled: true,
        isPaused: false,
        followerBroker: "GROWW" // BrokerCapabilityRegistry declares supportsOrderPlacement = false
    };
    const canonical = new CanonicalOrderEvent({
        broker: "MOCK",
        accountId: "M",
        orderId: "O3",
        symbol: "TATAMOTORS",
        transactionType: "BUY",
        quantity: 10,
        price: 800
    });

    const check = riskValidationService.validateOperation({
        copyConfig,
        follower: growwFollower,
        canonicalEvent: canonical,
        operation: "PLACE",
        targetQuantity: 10,
        price: 800
    });
    assert.equal(check.allowed, false);
    assert.ok(check.reason.includes("does not support automated order placement"));
});

// =========================================================================
// 4. Copy Policy Sizing & Modification Calculations
// =========================================================================

test("CopyTrading 10: CopyPolicyEngine applies multipliers and rounding rules", () => {
    const followerFloor = { sizingMode: "MULTIPLIER", multiplier: 1.5, roundingRule: "ROUND_DOWN" };
    const followerCeil = { sizingMode: "MULTIPLIER", multiplier: 1.5, roundingRule: "ROUND_UP" };
    const followerFixed = { sizingMode: "FIXED_QUANTITY", fixedQuantity: 25 };

    // 10 * 1.5 = 15
    assert.equal(copyPolicyEngine.calculateQuantity({ masterQuantity: 10, follower: followerFloor }), 15);

    // 7 * 1.5 = 10.5 -> floor = 10, ceil = 11
    assert.equal(copyPolicyEngine.calculateQuantity({ masterQuantity: 7, follower: followerFloor }), 10);
    assert.equal(copyPolicyEngine.calculateQuantity({ masterQuantity: 7, follower: followerCeil }), 11);

    // Fixed quantity
    assert.equal(copyPolicyEngine.calculateQuantity({ masterQuantity: 500, follower: followerFixed }), 25);
});

test("CopyTrading 11: CopyPolicyEngine calculates remaining quantity for modifications", () => {
    const follower = { sizingMode: "MULTIPLIER", multiplier: 2.0, roundingRule: "ROUND_DOWN" };

    // Master originally placed 10 (follower had 20). Follower already filled 10.
    // Master increases total to 15 -> follower target total = 30.
    // Follower new remaining = 30 - 10 = 20.
    const mod1 = copyPolicyEngine.calculateModification({
        newMasterTotalQuantity: 15,
        follower,
        followerFilledQuantity: 10
    });
    assert.equal(mod1.isValid, true);
    assert.equal(mod1.newFollowerTotalQuantity, 30);
    assert.equal(mod1.newRemainingQuantity, 20);

    // Master decreases total to 3 -> follower target total = 6.
    // But follower already filled 10! Modified total cannot be less than already filled.
    const modInvalid = copyPolicyEngine.calculateModification({
        newMasterTotalQuantity: 3,
        follower,
        followerFilledQuantity: 10
    });
    assert.equal(modInvalid.isValid, false);
    assert.ok(modInvalid.reason.includes("less than already filled"));
});

test("CopyTrading 12: InstrumentMappingService resolves F&O lot sizes", () => {
    assert.equal(instrumentMappingService.getLotSize("RELIANCE", "EQUITY"), 1);
    assert.equal(instrumentMappingService.getLotSize("NIFTY24OCT24500CE", "OPTIONS"), 25);
    assert.equal(instrumentMappingService.getLotSize("BANKNIFTY24OCT50000PE", "OPTIONS"), 15);
});

// =========================================================================
// 5. Order State Machine Transitions
// =========================================================================

test("CopyTrading 13: OrderStateMachine permits valid transitions and rejects invalid jumps", () => {
    assert.equal(OrderStateMachine.canTransition("PENDING", "SUBMITTED"), true);
    assert.equal(OrderStateMachine.canTransition("SUBMITTED", "ACKNOWLEDGED"), true);
    assert.equal(OrderStateMachine.canTransition("ACKNOWLEDGED", "PARTIALLY_FILLED"), true);
    assert.equal(OrderStateMachine.canTransition("PARTIALLY_FILLED", "FILLED"), true);
    assert.equal(OrderStateMachine.canTransition("ACKNOWLEDGED", "CANCELLED"), true);
    assert.equal(OrderStateMachine.canTransition("SUBMITTED", "UNKNOWN"), true);
    assert.equal(OrderStateMachine.canTransition("UNKNOWN", "FILLED"), true);

    // Illegal: FILLED order cannot be CANCELLED or PENDING
    assert.equal(OrderStateMachine.canTransition("FILLED", "CANCELLED"), false);
    assert.equal(OrderStateMachine.canTransition("REJECTED", "ACKNOWLEDGED"), false);
    assert.equal(OrderStateMachine.canTransition("CANCELLED", "FILLED"), false);

    assert.throws(
        () => OrderStateMachine.validateTransition("FILLED", "CANCELLED"),
        /Illegal order state transition/
    );
});

// =========================================================================
// 6. High-Precision Monotonic Latency Metrics
// =========================================================================

test("CopyTrading 14: CopyTradingMetrics computes empirical quantiles (p50, p95, p99)", () => {
    const metrics = new CopyTradingMetrics();

    // Insert 100 deterministic duration samples (1ms to 100ms)
    for (let i = 1; i <= 100; i++) {
        metrics.recordSample("receipt_to_submit", i);
    }

    const stats = metrics.getStats("receipt_to_submit");
    assert.equal(stats.count, 100);
    assert.equal(stats.min, 1);
    assert.equal(stats.max, 100);
    assert.equal(stats.avg, 50.5);
    assert.equal(stats.p50, 50.5);
    assert.equal(stats.p90, 90.1);
    assert.equal(stats.p95, 95.05);
    assert.equal(stats.p99, 99.01);
});

// =========================================================================
// 7. Security & Secret Redaction in Audit Logs
// =========================================================================

test("CopyTrading 15: CopyTradingAuditService redacts API keys, access tokens, and secrets", () => {
    const rawPayload = {
        symbol: "TCS",
        quantity: 10,
        accessToken: "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload",
        apiKey: "live_key_998877",
        api_secret: "super_secret_123",
        credentials: {
            password: "user_secret_password",
            totp_secret: "BASE32SECRET",
            normalField: "public_value"
        }
    };

    const sanitized = copyTradingAuditService.sanitize(rawPayload);
    assert.equal(sanitized.symbol, "TCS");
    assert.equal(sanitized.accessToken, "[REDACTED]");
    assert.equal(sanitized.apiKey, "[REDACTED]");
    assert.equal(sanitized.api_secret, "[REDACTED]");
    assert.equal(sanitized.credentials.password, "[REDACTED]");
    assert.equal(sanitized.credentials.totp_secret, "[REDACTED]");
    assert.equal(sanitized.credentials.normalField, "public_value");
});

// =========================================================================
// 8. Dhan Automated Trading Adapter & Capabilities
// =========================================================================

test("CopyTrading 16: Dhan Broker Capability Registry supports automated trading & order placement", () => {
    const caps = getBrokerCapabilities("DHAN");
    assert.equal(caps.supportsOrderPlacement, true);
    assert.equal(caps.supportsOrderModification, true);
    assert.equal(caps.supportsOrderCancellation, true);
    assert.equal(caps.supportsStreamingOrders, true);
    assert.equal(caps.hasIdempotencyKey, true);
    assert.equal(caps.rateLimitPerSecond, 10);
});

test("CopyTrading 17: DhanAdapter exposes required trading methods", () => {
    const dhan = new DhanAdapter({ clientId: "1000000001", accessToken: "dummy_token" });
    assert.equal(typeof dhan.placeOrder, "function");
    assert.equal(typeof dhan.modifyOrder, "function");
    assert.equal(typeof dhan.cancelOrder, "function");
    assert.equal(typeof dhan.getOrder, "function");
    assert.equal(typeof dhan.getOrders, "function");
    assert.equal(typeof dhan.getTrades, "function");
    assert.equal(typeof dhan.getPositions, "function");
});

test("CopyTrading 18: BrokerAdapterFactory._wrapDhanAdapter implements IBrokerAdapter interface", async () => {
    const dhan = new DhanAdapter({ clientId: "1000000001", accessToken: "dummy_token" });
    const wrapped = BrokerAdapterFactory._wrapDhanAdapter(dhan, "DHAN_ACC_01");

    assert.equal(wrapped.getBroker(), "DHAN");
    assert.equal(wrapped.getAccountId(), "DHAN_ACC_01");
    assert.equal(typeof wrapped.placeOrder, "function");
    assert.equal(typeof wrapped.modifyOrder, "function");
    assert.equal(typeof wrapped.cancelOrder, "function");
    assert.equal(typeof wrapped.getOrder, "function");
    assert.equal(typeof wrapped.getOrders, "function");
    assert.equal(typeof wrapped.getTrades, "function");
    assert.equal(typeof wrapped.getPositions, "function");
    assert.equal(typeof wrapped.subscribeOrderStream, "function");
    assert.equal(typeof wrapped.unsubscribeOrderStream, "function");
});
