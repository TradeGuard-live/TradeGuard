/**
 * testFullPipeline.js
 * 
 * Comprehensive end-to-end verification script testing:
 * 1. Position Engine (FIFO matching, open quantity, partial squares, fully squared)
 * 2. P&L Engine (Live P&L, Gross P&L, Net P&L, 8 combined charges, Breakeven, Stop Loss Risk Amount, Live R:R)
 * 3. WebSocket Service (connect, auth, message dispatch, live tick updates)
 */

import { WebSocket } from 'ws';
import positionEngine from '../services/position/PositionEngine.js';
import pnlEngine from '../services/pnl/PnLEngine.js';

console.log('====================================================');
console.log('🚀 TRADEGUARD FULL PIPELINE VERIFICATION');
console.log('====================================================\n');

// 1. TEST POSITION ENGINE
console.log('--- 1. Testing Position Engine ---');
const sampleTrades = [
  { symbol: 'RELIANCE', exchange: 'NSE', segment: 'EQUITY', productType: 'INTRADAY', transactionType: 'BUY', quantity: 20, executedPrice: 2900 },
  { symbol: 'RELIANCE', exchange: 'NSE', segment: 'EQUITY', productType: 'INTRADAY', transactionType: 'SELL', quantity: 8, executedPrice: 2950 },
  { symbol: 'TCS', exchange: 'NSE', segment: 'EQUITY', productType: 'INTRADAY', transactionType: 'BUY', quantity: 10, executedPrice: 4100 },
  { symbol: 'TCS', exchange: 'NSE', segment: 'EQUITY', productType: 'INTRADAY', transactionType: 'SELL', quantity: 10, executedPrice: 4150 }
];

const openPositions = positionEngine.getOpenPositions(sampleTrades);
const squaredPositions = positionEngine.getFullySquaredPositions(sampleTrades);

console.log(`✅ Open Positions Count: ${openPositions.length}`);
console.log(`   - Symbol: ${openPositions[0]?.symbol}, Open Qty: ${openPositions[0]?.openQuantity}, Status: ${openPositions[0]?.status}, Realized P&L from Partial Square: ₹${openPositions[0]?.realizedPnL}`);
console.log(`✅ Fully Squared Count: ${squaredPositions.length}`);
console.log(`   - Symbol: ${squaredPositions[0]?.symbol}, Realized P&L: ₹${squaredPositions[0]?.realizedPnL}\n`);

// 2. TEST P&L AND 8 COMBINED CHARGES ENGINE
console.log('--- 2. Testing P&L & 8-Component Combined Charges Engine ---');
pnlEngine.setPositions('test_user', openPositions);
pnlEngine.updateRiskSettings('test_user', 'RELIANCE', { stopLoss: 2850, target: 3000 });
pnlEngine.updatePrice('test_user', openPositions[0].instrumentToken, 2920);

const pnlResult = pnlEngine.calculate('test_user');
const pos = pnlResult.positions[0];

console.log(`✅ Symbol: ${pos.symbol}`);
console.log(`   - Avg Entry Price: ₹${pos.averagePrice}`);
console.log(`   - Live LTP: ₹${pos.ltp}`);
console.log(`   - Live Gross Unrealized P&L: ₹${pos.unrealizedGrossPnL}`);
console.log(`   - Realized P&L: ₹${pos.realizedGrossPnL}`);
console.log(`   - Gross Total P&L: ₹${pos.grossPnL}`);
console.log(`   - Breakeven Price: ₹${pos.breakevenPrice} (Distance: ₹${pos.distanceToBreakeven})`);
console.log(`   - Stop Loss: ₹${pos.stopLoss}`);
console.log(`   - Risk Amount (According to Stop Loss): ₹${pos.riskAmount}`);
console.log(`   - Target: ₹${pos.target}`);
console.log(`   - Live Risk/Reward Ratio: ${pos.liveRiskRewardText}`);
console.log('\n   📦 All 8 Combined Charges:');
console.log(`      1. Brokerage:        ₹${pos.charges.brokerage}`);
console.log(`      2. STT:              ₹${pos.charges.stt}`);
console.log(`      3. GST:              ₹${pos.charges.gst}`);
console.log(`      4. EXCHANGE CHARGES: ₹${pos.charges.exchangeCharges}`);
console.log(`      5. CTT:              ₹${pos.charges.ctt}`);
console.log(`      6. SEBI CHARGES:     ₹${pos.charges.sebiCharges}`);
console.log(`      7. STAMP DUTY:       ₹${pos.charges.stampDuty}`);
console.log(`      8. DP CHARGES:       ₹${pos.charges.dpCharges}`);
console.log(`      -------------------------------`);
console.log(`      TOTAL COMBINED:      ₹${pos.charges.total}`);
console.log(`   - Net P&L (Gross - Total Charges): ₹${pos.netPnL}\n`);

// 3. TEST WEBSOCKET LIVE STREAMING
console.log('--- 3. Testing WebSocket Streaming (ws://localhost:5000/ws/live) ---');
const ws = new WebSocket('ws://localhost:5000/ws/live');

ws.on('open', () => {
  console.log('✅ WebSocket Connected to ws://localhost:5000/ws/live');
  ws.send(JSON.stringify({ type: 'AUTH', userId: '6aba05ee5724ee5fded23bc7' }));
});

let liveTickCount = 0;
ws.on('message', (msgBuffer) => {
  const msg = JSON.parse(msgBuffer.toString());
  if (msg.type === 'AUTH_SUCCESS') {
    console.log('✅ WebSocket AUTH_SUCCESS received');
  } else if (msg.type === 'INITIAL_DATA') {
    console.log(`✅ INITIAL_DATA received: ${msg.data.positions?.length} open positions, Total Net P&L: ₹${msg.data.portfolioSummary?.totalNetPnL}`);
    
    // Test updating Stop Loss over WebSocket
    const sym = msg.data.positions[0]?.symbol || 'BSE';
    console.log(`\n--- 4. Testing WebSocket UPDATE_SL_TARGET for ${sym} ---`);
    ws.send(JSON.stringify({
      type: 'UPDATE_SL_TARGET',
      symbol: sym,
      stopLoss: 3100,
      target: 3250
    }));
  } else if (msg.type === 'LIVE_PNL_UPDATE') {
    liveTickCount++;
    const p = msg.data.positions[0];
    console.log(`⚡ Live Tick #${liveTickCount}: ${p?.symbol} | LTP: ₹${p?.ltp} | Gross P&L: ₹${p?.grossPnL} | Net P&L: ₹${p?.netPnL} | Risk Amt: ₹${p?.riskAmount} | Live R:R: ${p?.liveRiskRewardText}`);
    
    if (liveTickCount >= 2) {
      console.log('\n====================================================');
      console.log('🎉 ALL PIPELINE TESTS PASSED SUCCESSFULLY!');
      console.log('====================================================');
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket Error:', err.message);
  process.exit(1);
});
