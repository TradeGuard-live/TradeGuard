import mongoose from "mongoose";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import BrokerAccount from "../models/BrokerAccount.js";
import TradeRecord from "../models/TradeRecord.js";
import { mapAngelOneTrade } from "../brokers/angelOne/AngelOneMapper.js";

/**
 * Angel One Postback Handler
 * POST /api/webhooks/angelone/postback
 *
 * Angel One SmartAPI can push order execution updates to this endpoint
 * in real-time when configured in the SmartAPI app settings.
 *
 * The postback payload contains the full order/trade details.
 * We map and upsert each completed trade into TradeRecord.
 */
export const angelOnePostback = async (req, res) => {
    try {
        const payload = req.body;

        if (!payload) {
            return res.status(400).json({
                success: false,
                message: "Empty postback payload"
            });
        }

        console.log("[AngelOne Postback] Received:", JSON.stringify(payload).slice(0, 500));

        // The postback may contain a single order object or an array
        const orders = Array.isArray(payload) ? payload : [payload];

        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        for (const order of orders) {
            try {
                // Only process completed/traded orders
                const status = String(order.orderstatus || order.status || "").toLowerCase();
                const filledQty = Number(
                    order.fillsize || order.filledshares || order.quantity || 0
                );

                if (
                    status !== "complete" &&
                    status !== "traded" &&
                    status !== "executed" &&
                    filledQty <= 0
                ) {
                    console.log(`[AngelOne Postback] Skipping non-complete order: status=${status}, qty=${filledQty}`);
                    skipped++;
                    continue;
                }

                // Find the broker account by clientCode
                const clientCode = String(
                    order.clientcode || order.clientid || order.client_code || ""
                ).trim().toUpperCase();

                if (!clientCode) {
                    console.warn("[AngelOne Postback] Order missing clientcode, trying all Angel One accounts");
                }

                // Find matching broker account
                let brokerAccount = null;
                if (clientCode) {
                    brokerAccount = await BrokerAccount.findOne({
                        broker: "ANGEL_ONE",
                        "credentials.clientId": clientCode,
                        isActive: true
                    });
                }

                if (!brokerAccount) {
                    // Try to find any active Angel One account
                    brokerAccount = await BrokerAccount.findOne({
                        broker: "ANGEL_ONE",
                        isActive: true
                    });
                }

                if (!brokerAccount) {
                    console.warn("[AngelOne Postback] No matching broker account found for clientCode:", clientCode);
                    skipped++;
                    continue;
                }

                // Map the trade using existing mapper
                const mappedTrade = mapAngelOneTrade(order);
                mappedTrade.userId = brokerAccount.userId;
                mappedTrade.brokerAccountId = brokerAccount._id;
                mappedTrade.broker = "ANGEL_ONE";

                if (!mappedTrade.tradeId) {
                    console.warn("[AngelOne Postback] Trade missing tradeId, skipping");
                    skipped++;
                    continue;
                }

                // Upsert into TradeRecord
                const result = await TradeRecord.updateOne(
                    {
                        brokerAccountId: brokerAccount._id,
                        tradeId: mappedTrade.tradeId
                    },
                    { $set: mappedTrade },
                    { upsert: true }
                );

                if (result.upsertedCount === 1) {
                    inserted++;
                    console.log(`[AngelOne Postback] New trade captured: ${mappedTrade.symbol} ${mappedTrade.transactionType} x${mappedTrade.quantity}`);
                } else {
                    updated++;
                }
            } catch (itemErr) {
                if (itemErr.code === 11000) {
                    skipped++; // Duplicate
                } else {
                    console.warn("[AngelOne Postback] Item error:", itemErr.message);
                    skipped++;
                }
            }
        }

        console.log(`[AngelOne Postback] Result: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);

        return res.status(200).json({
            success: true,
            message: "Postback processed",
            data: { inserted, updated, skipped }
        });
    } catch (error) {
        console.error("[AngelOne Postback] Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Postback processing failed"
        });
    }
};


/**
 * Helper: Parse trade date from string or Excel serial number
 */
function parseTradeDate(val) {
    if (!val) return new Date();
    // Excel serial number (e.g. 46224 -> July 21, 2026)
    if (typeof val === "number" || (!isNaN(val) && Number(val) > 30000 && Number(val) < 60000)) {
        const serial = Number(val);
        return new Date(Math.round((serial - 25569) * 86400 * 1000));
    }
    const str = String(val).trim();
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        return d;
    }
    // Handle DD/MM/YYYY or DD-MM-YYYY format
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (dmy) {
        const day = parseInt(dmy[1], 10);
        const month = parseInt(dmy[2], 10) - 1;
        const year = parseInt(dmy[3], 10);
        const h = parseInt(dmy[4] || "0", 10);
        const m = parseInt(dmy[5] || "0", 10);
        const s = parseInt(dmy[6] || "0", 10);
        const parsed = new Date(year, month, day, h, m, s);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

/**
 * Helper: Map raw segment string to TradeRecord enum ["EQUITY", "FUTURES", "OPTIONS"]
 */
function parseSegment(rawSeg, exchange, symbol) {
    const s = String(rawSeg || "").toUpperCase();
    const sym = String(symbol || "").toUpperCase();
    const ex = String(exchange || "").toUpperCase();

    if (sym.endsWith("CE") || sym.endsWith("PE") || sym.includes("-CE-") || sym.includes("-PE-") || sym.includes("OPT")) {
        return "OPTIONS";
    }
    if (s.includes("FUT") || ex === "NFO" || ex === "MCX" || ex === "BFO" || sym.endsWith("FUT")) {
        return "FUTURES";
    }
    return "EQUITY";
}

/**
 * Helper: Map order type and product code
 */
function parseOrderAndProduct(rawOrderType, rawSegment) {
    const ot = String(rawOrderType || "").toUpperCase();
    const seg = String(rawSegment || "").toUpperCase();

    let productCode = "INTRADAY";
    if (ot.includes("DELIVERY") || ot.includes("CNC") || seg.includes("DELIVERY")) {
        productCode = "DELIVERY";
    } else if (ot.includes("MARGIN")) {
        productCode = "MARGIN";
    } else if (ot.includes("CARRYFORWARD") || ot.includes("NRML")) {
        productCode = "CARRYFORWARD";
    } else if (ot.includes("INTRADAY") || ot.includes("MIS")) {
        productCode = "INTRADAY";
    }

    let orderType = "MARKET";
    if (ot.includes("LIMIT")) {
        orderType = "LIMIT";
    } else if (ot.includes("STOPLOSS_MARKET") || ot === "SL-M") {
        orderType = "SL-M";
    } else if (ot.includes("STOPLOSS") || ot === "SL") {
        orderType = "SL";
    }

    return { productCode, orderType };
}


/**
 * Angel One CSV / Excel Import
 * POST /api/webhooks/angelone/import-csv/:brokerAccountId
 *
 * Accepts a CSV or Excel file exported from the Angel One web portal
 * (e.g. TradeBook, Trades History, Charges report) and imports each trade
 * into the TradeRecord collection.
 */
export const angelOneImportCsv = async (req, res) => {
    try {
        const { brokerAccountId } = req.params;

        if (!brokerAccountId || !mongoose.Types.ObjectId.isValid(brokerAccountId)) {
            return res.status(400).json({
                success: false,
                message: "Valid brokerAccountId is required"
            });
        }

        const brokerAccount = await BrokerAccount.findById(brokerAccountId);
        if (!brokerAccount) {
            return res.status(404).json({
                success: false,
                message: "Broker account not found"
            });
        }

        if (brokerAccount.broker !== "ANGEL_ONE") {
            return res.status(400).json({
                success: false,
                message: "This import endpoint is only for Angel One accounts"
            });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "File is required. Upload with field name 'file'."
            });
        }

        const buffer = req.file.buffer;
        let rows = [];

        // Check if file is Excel (starts with ZIP signature 'PK' 0x50 0x4B) or has .xlsx/.xls extension
        const isExcel = (buffer[0] === 0x50 && buffer[1] === 0x4B) ||
            req.file.originalname?.endsWith(".xlsx") ||
            req.file.originalname?.endsWith(".xls") ||
            req.file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            req.file.mimetype === "application/vnd.ms-excel";

        if (isExcel) {
            try {
                const wb = XLSX.read(buffer, { type: "buffer" });
                const firstSheetName = wb.SheetNames[0];
                const sheet = wb.Sheets[firstSheetName];
                rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
            } catch (xlsxErr) {
                return res.status(400).json({
                    success: false,
                    message: `Excel parse error: ${xlsxErr.message}`
                });
            }
        } else {
            const csvContent = buffer.toString("utf-8");
            try {
                rows = parse(csvContent, {
                    relax_column_count: true,
                    skip_empty_lines: false,
                    trim: true
                });
            } catch (parseErr) {
                return res.status(400).json({
                    success: false,
                    message: `CSV parse error: ${parseErr.message}`
                });
            }
        }

        if (!rows || rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Uploaded file is empty"
            });
        }

        console.log(`[AngelOne Import] Parsed ${rows.length} total raw rows`);

        // Find the table header row dynamically
        // Handles multi-section reports where metadata/charges appear before the TradeBook table
        let headerIdx = -1;
        for (let i = 0; i < rows.length; i++) {
            const r = (rows[i] || []).map(c => String(c || "").trim().toLowerCase());
            const hasSymbol = r.some(c =>
                c.includes("scrip") || c.includes("symbol") || c.includes("contract") || c.includes("tradingsymbol")
            );
            const hasSideOrTrade = r.some(c =>
                c.includes("buy/sell") || c.includes("trade id") || c.includes("side") ||
                c.includes("order id") || c.includes("buy price") || c.includes("quantity")
            );

            if (hasSymbol && hasSideOrTrade) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) {
            // Fallback: test if row 0 has any trade column names
            headerIdx = 0;
        }

        console.log(`[AngelOne Import] Trade table header identified at row ${headerIdx}`);

        const headers = (rows[headerIdx] || []).map(c => String(c || "").trim().toLowerCase());
        console.log("[AngelOne Import] Headers:", headers);

        // Helper to find column index with exact match prioritization
        const getCol = (...names) => {
            // Exact match
            for (const name of names) {
                const idx = headers.findIndex(h => h === name);
                if (idx !== -1) return idx;
            }
            // StartsWith match
            for (const name of names) {
                const idx = headers.findIndex(h => h.startsWith(name));
                if (idx !== -1) return idx;
            }
            // Includes match
            for (const name of names) {
                const idx = headers.findIndex(h => h.includes(name));
                if (idx !== -1) return idx;
            }
            return -1;
        };

        const symbolCol = getCol("scrip/contract", "scrip", "symbol", "tradingsymbol", "contract", "instrument");
        const sideCol = getCol("buy/sell", "transaction type", "transaction_type", "side", "type");
        const buyPriceCol = getCol("buy price", "buy_price");
        const sellPriceCol = getCol("sell price", "sell_price");
        const priceCol = getCol("trade price", "executed price", "price", "avg_price", "average price", "avg. price", "rate");
        const qtyCol = getCol("quantity", "qty", "filled_qty", "traded qty", "volume");
        const orderTypeCol = getCol("order type", "order_type", "ordertype");
        const segmentCol = getCol("segment", "product type", "product");
        const exchangeCol = getCol("exchange", "exch");
        const orderIdCol = getCol("order id", "order_id", "order no", "orderno");
        const tradeIdCol = getCol("trade id", "trade_id", "fill id", "fillid");
        const dateCol = getCol("date", "trade date", "trade_date", "trade time", "time");

        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        let totalTradesProcessed = 0;

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length === 0) continue;

            const firstCell = String(r[0] || "").trim();
            // Skip empty rows, summary blocks, notes, and disclaimers
            if (
                !firstCell ||
                firstCell.startsWith("NOTE:") ||
                firstCell.toLowerCase().includes("accurate till") ||
                firstCell.toLowerCase().startsWith("total") ||
                firstCell.toLowerCase().startsWith("disclaimer")
            ) {
                continue;
            }

            const symbol = String(r[symbolCol] || "").trim();
            if (!symbol) {
                continue;
            }

            // Transaction Type (BUY / SELL)
            let rawSide = sideCol >= 0 ? String(r[sideCol] || "").trim().toUpperCase() : "";
            const buyPriceRaw = buyPriceCol >= 0 && r[buyPriceCol] !== "" ? Number(r[buyPriceCol]) : null;
            const sellPriceRaw = sellPriceCol >= 0 && r[sellPriceCol] !== "" ? Number(r[sellPriceCol]) : null;

            if (!rawSide || (rawSide !== "BUY" && rawSide !== "SELL")) {
                if (rawSide === "B") rawSide = "BUY";
                else if (rawSide === "S") rawSide = "SELL";
                else if (buyPriceRaw && !sellPriceRaw) rawSide = "BUY";
                else if (sellPriceRaw && !buyPriceRaw) rawSide = "SELL";
            }

            if (rawSide !== "BUY" && rawSide !== "SELL") {
                console.warn(`[AngelOne Import] Row ${i}: Cannot determine BUY/SELL for ${symbol}, skipping`);
                skipped++;
                continue;
            }

            // Executed Price
            let executedPrice = 0;
            if (rawSide === "BUY" && buyPriceRaw) {
                executedPrice = buyPriceRaw;
            } else if (rawSide === "SELL" && sellPriceRaw) {
                executedPrice = sellPriceRaw;
            } else if (priceCol >= 0 && r[priceCol] !== "" && !isNaN(Number(r[priceCol]))) {
                executedPrice = Number(r[priceCol]);
            } else {
                executedPrice = buyPriceRaw || sellPriceRaw || 0;
            }

            // Quantity
            const quantity = qtyCol >= 0 ? Math.abs(Number(r[qtyCol]) || 0) : 0;
            if (quantity <= 0) {
                console.warn(`[AngelOne Import] Row ${i}: Quantity is 0 for ${symbol}, skipping`);
                skipped++;
                continue;
            }

            // Order & Trade IDs
            const orderId = orderIdCol >= 0 ? String(r[orderIdCol] || "").trim() : "";
            const rawTradeId = tradeIdCol >= 0 ? String(r[tradeIdCol] || "").trim() : "";
            const tradeDate = parseTradeDate(dateCol >= 0 ? r[dateCol] : null);
            const dateStr = tradeDate.toISOString().split("T")[0];

            const finalTradeId = rawTradeId || (orderId ? `TRD-${orderId}` : `CSV-${symbol}-${dateStr}-${rawSide}-${quantity}-${executedPrice}`);
            const exchange = exchangeCol >= 0 && r[exchangeCol] ? String(r[exchangeCol]).trim().toUpperCase() : "NSE";
            const segment = parseSegment(segmentCol >= 0 ? r[segmentCol] : "", exchange, symbol);
            const { productCode, orderType } = parseOrderAndProduct(
                orderTypeCol >= 0 ? r[orderTypeCol] : "",
                segmentCol >= 0 ? r[segmentCol] : ""
            );

            totalTradesProcessed++;

            const tradeDoc = {
                userId: brokerAccount.userId,
                brokerAccountId: brokerAccount._id,
                broker: "ANGEL_ONE",
                tradeId: finalTradeId,
                orderId: orderId || `ORD-${finalTradeId}`,
                symbol,
                exchange,
                segment,
                transactionType: rawSide,
                quantity,
                executedPrice,
                orderType,
                status: "COMPLETE",
                productCode,
                tradeTime: tradeDate,
                brokerResponse: {
                    source: "ANGEL_ONE_PORTAL_EXPORT",
                    rawRow: r
                }
            };

            const result = await TradeRecord.updateOne(
                {
                    brokerAccountId: brokerAccount._id,
                    tradeId: finalTradeId
                },
                { $set: tradeDoc },
                { upsert: true }
            );

            if (result.upsertedCount === 1) {
                inserted++;
                console.log(`[AngelOne Import] Inserted trade: ${symbol} ${rawSide} x${quantity} @ ₹${executedPrice} (TradeId: ${finalTradeId})`);
            } else {
                updated++;
                console.log(`[AngelOne Import] Updated trade: ${symbol} ${rawSide} x${quantity} (TradeId: ${finalTradeId})`);
            }
        }

        console.log(`[AngelOne Import] Result: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);

        return res.status(200).json({
            success: true,
            message: `Import complete: ${inserted} new trades added, ${updated} updated`,
            data: {
                totalTradesProcessed,
                inserted,
                updated,
                skipped
            }
        });
    } catch (error) {
        console.error("[AngelOne Import] Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "File import failed"
        });
    }
};

export default {
    angelOnePostback,
    angelOneImportCsv
};
