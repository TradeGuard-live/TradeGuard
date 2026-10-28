import React, { useState } from 'react';
import { useLiveTrading } from '../hooks/useLiveTrading';
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  ShieldAlert,
  Target,
  Zap,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  Layers,
  Scale,
  Receipt,
  X,
} from 'lucide-react';

function formatINR(val) {
  const num = Number(val || 0);
  const sign = num < 0 ? '-' : '';
  return `${sign}₹${Math.abs(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ✅ Renders quote freshness badge with semantic color codes
function renderQuoteFreshnessBadge(status) {
  switch (status) {
    case 'LIVE':
      return <span className="quote-badge quote-badge-live">LIVE</span>;
    case 'MARKET CLOSED':
      return <span className="quote-badge quote-badge-closed">MARKET CLOSED</span>;
    case 'DELAYED':
      return <span className="quote-badge quote-badge-delayed">DELAYED</span>;
    case 'STALE':
      return <span className="quote-badge quote-badge-stale">STALE</span>;
    case 'CONNECTING':
      return <span className="quote-badge quote-badge-stale">CONNECTING</span>;
    case 'DISCONNECTED':
      return <span className="quote-badge quote-badge-unavailable">DISCONNECTED</span>;
    case 'UNAVAILABLE':
    default:
      return <span className="quote-badge quote-badge-unavailable">UNAVAILABLE</span>;
  }
}

export default function LiveTrading() {
  const {
    isConnected,
    isConnecting,
    isMarketOpen,
    error,
    positions,
    squaredPositions,
    portfolioSummary,
    lastTickTime,
    priceFlash,
    updateSLTarget,
    syncTrades,
    refresh,
    reconnect,
  } = useLiveTrading();

  const [refreshing, setRefreshing] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [selectedChargesPosition, setSelectedChargesPosition] = useState(null);
  const [showPortfolioChargesModal, setShowPortfolioChargesModal] = useState(false);
  const [editingSL, setEditingSL] = useState({}); // { [symbol]: stopLossValue }
  const [editingTarget, setEditingTarget] = useState({}); // { [symbol]: targetValue }
  const [activeTab, setActiveTab] = useState('open'); // 'open' | 'squared' | 'engine'

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncTrades();
    } finally {
      setTimeout(() => setSyncing(false), 800);
    }
  };

  // ✅ Non-destructive manual refresh action
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  };

  const handleSaveRisk = (pos) => {
    const symbol = pos.symbol;
    const sl = editingSL[symbol] !== undefined ? editingSL[symbol] : pos.stopLoss;
    const tgt = editingTarget[symbol] !== undefined ? editingTarget[symbol] : pos.target;
    updateSLTarget(symbol, Number(sl), Number(tgt));
  };

  const charges = portfolioSummary?.totalCharges || {};
  const isNetProfit = (portfolioSummary?.totalNetPnL || 0) >= 0;
  const isGrossProfit = (portfolioSummary?.totalGrossPnL || 0) >= 0;

  return (
    <div className="live-trading-container">
      {/* Top Header Bar */}
      <div className="page-header page-header-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Live Trading Terminal
            </h1>
            <span
              className={`live-ws-pill ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}
            >
              <span className="live-ws-pulse" />
              {isConnected
                ? 'WebSocket Live'
                : isConnecting
                ? 'Connecting WS...'
                : 'WS Offline'}
            </span>

            {/* ✅ Market-Data & Exchange Session Status Badge */}
            {isConnected ? (
              isMarketOpen ? (
                <span className="quote-badge quote-badge-live" title="Indian Stock Exchanges (NSE/BSE) are open">
                  🟢 LIVE FEED
                </span>
              ) : (
                <span className="quote-badge quote-badge-closed" title="Indian Stock Exchanges (NSE/BSE) are closed. Prices frozen to last official close.">
                  ⚪ MARKET CLOSED
                </span>
              )
            ) : isConnecting ? (
              <span className="quote-badge quote-badge-stale">🟡 CONNECTING...</span>
            ) : (
              <span className="quote-badge quote-badge-unavailable">🔴 DISCONNECTED</span>
            )}
          </div>
          <p className="page-description" style={{ marginTop: 4 }}>
            Real-time live P&amp;L, dynamic risk/reward, breakeven analysis, and 8-component combined charges streaming from Position &amp; P&amp;L Engines.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {lastTickTime && (
            <div className="live-clock-badge">
              <Zap size={13} style={{ color: '#10b981' }} />
              <span>Tick: {new Date(lastTickTime).toLocaleTimeString()}</span>
            </div>
          )}

          {/* ✅ Manual refresh action that preserves valid positions */}
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title="Refresh positions without resetting valid market data"
          >
            <RefreshCw size={14} className={refreshing ? 'spinner-rotate' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={syncing ? 'spinner-rotate' : ''} />
            {syncing ? 'Syncing Upstox...' : 'Sync Upstox Data'}
          </button>

          {!isConnected && !isConnecting && (
            <button className="btn btn-primary" onClick={reconnect}>
              Reconnect WS
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="info-banner" style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Top Metric Cards */}
      {/* ✅ Top Metric Cards: Separates Invested Capital, Market Value, Gross P&L, Charges, Net P&L, Realized P&L */}
      <div className="stat-grid live-stat-grid" style={{ marginBottom: 24 }}>
        {/* 1. Invested Capital */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Invested Capital</span>
            <Layers size={16} style={{ color: '#94a3b8' }} />
          </div>
          <div className="live-card-value" style={{ color: 'var(--text-primary)' }}>
            {formatINR(portfolioSummary.totalInvestedCapital || (positions.reduce((acc, p) => acc + (p.investedCapital || (p.openQuantity * p.averagePrice)), 0)))}
          </div>
          <div className="live-card-sub">
            <span>Entry price basis</span>
            <span style={{ color: 'var(--text-secondary)' }}>{positions.length} Open Pos</span>
          </div>
        </div>

        {/* 2. Current Market Value */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Current Market Value</span>
            <Activity size={16} style={{ color: '#38bdf8' }} />
          </div>
          <div className="live-card-value" style={{ color: '#38bdf8' }}>
            {formatINR(portfolioSummary.totalMarketValue || (positions.reduce((acc, p) => acc + (p.marketValue || (p.openQuantity * (p.ltp || p.averagePrice))), 0)))}
          </div>
          <div className="live-card-sub">
            <span>Dynamic open valuation</span>
            <span className="live-badge-glow">Live Quote</span>
          </div>
        </div>

        {/* 3. Unrealized Gross P&L */}
        <div className={`live-card ${portfolioSummary.totalUnrealizedPnL >= 0 ? 'card-emerald' : 'card-rose'}`}>
          <div className="live-card-header">
            <span className="live-card-label">Unrealized Gross P&amp;L</span>
            <Scale size={16} style={{ color: portfolioSummary.totalUnrealizedPnL >= 0 ? '#10b981' : '#ef4444' }} />
          </div>
          <div className={`live-card-value ${portfolioSummary.totalUnrealizedPnL >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {formatINR(portfolioSummary.totalUnrealizedPnL)}
          </div>
          <div className="live-card-sub">
            <span>Market Value − Invested</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Realized: {formatINR(portfolioSummary.totalRealizedPnL)}
            </span>
          </div>
        </div>

        {/* 4. Total Combined Charges */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Total Charges (Combined)</span>
            <Receipt size={16} style={{ color: '#f59e0b' }} />
          </div>
          <div className="live-card-value" style={{ color: '#fbbf24' }}>
            {formatINR(charges.total)}
          </div>
          <div className="live-card-sub">
            <span>8 Mandatory Fees Combined</span>
            <button
              className="text-btn"
              style={{ color: '#38bdf8', fontSize: 12, textDecoration: 'underline' }}
              onClick={() => setShowPortfolioChargesModal(true)}
            >
              View Breakdown
            </button>
          </div>
        </div>

        {/* 5. Net P&L */}
        <div className={`live-card ${isNetProfit ? 'card-emerald' : 'card-rose'}`}>
          <div className="live-card-header">
            <span className="live-card-label">Net P&amp;L</span>
            {isNetProfit ? (
              <ArrowUpRight size={18} style={{ color: '#10b981' }} />
            ) : (
              <ArrowDownRight size={18} style={{ color: '#ef4444' }} />
            )}
          </div>
          <div className={`live-card-value ${isNetProfit ? 'text-emerald' : 'text-rose'}`}>
            {formatINR(portfolioSummary.totalNetPnL)}
          </div>
          <div className="live-card-sub">
            <span>Gross P&amp;L − Total Charges</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>Bottom-Line</span>
          </div>
        </div>

        {/* 6. Live Risk / Reward */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Live Risk / Reward</span>
            <Target size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div className="live-card-value" style={{ color: '#c4b5fd' }}>
            {portfolioSummary.portfolioRiskRewardText || '1:2.0'}
          </div>
          <div className="live-card-sub">
            <span>Risk: {formatINR(portfolioSummary.totalRiskAmount)}</span>
            <span className="live-rr-tag">Portfolio Avg</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Navigation Tabs */}
        <div className="live-tabs-header">
          <div className="live-tab-buttons">
            <button
              className={`live-tab-btn ${activeTab === 'open' ? 'active' : ''}`}
              onClick={() => setActiveTab('open')}
            >
              Open Positions ({positions.length})
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'squared' ? 'active' : ''}`}
              onClick={() => setActiveTab('squared')}
            >
              Squared Off ({squaredPositions.length})
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'engine' ? 'active' : ''}`}
              onClick={() => setActiveTab('engine')}
            >
              Position Engine Status
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 16 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Showing {positions.length} active positions
            </span>
          </div>
        </div>

        {/* TAB 1: OPEN POSITIONS */}
        {/* TAB 1: OPEN POSITIONS */}
        {activeTab === 'open' && (
          <div className="table-responsive">
            <table className="data-table live-table">
              <thead>
                <tr>
                  <th>Instrument &amp; Exchange</th>
                  <th>Direction / Qty</th>
                  <th>Avg Entry Price</th>
                  <th>Current / Valid Price</th>
                  <th>Market Value</th>
                  <th>Breakeven</th>
                  <th>Stop Loss &amp; Risk Amt</th>
                  <th>Target &amp; Live R:R</th>
                  <th>Total Charges</th>
                  <th>Gross P&amp;L</th>
                  <th>Net P&amp;L</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                      No active open positions. Sync your Upstox account or execute a trade to view real-time data.
                    </td>
                  </tr>
                ) : (
                  positions.map((pos) => {
                    const flash = priceFlash[pos.symbol] || priceFlash[pos.instrumentToken];
                    const isLong = pos.side === 'BUY';
                    const isProfitable = pos.grossPnL >= 0;
                    const isNetProfitable = pos.netPnL >= 0;

                    const slVal =
                      editingSL[pos.symbol] !== undefined
                        ? editingSL[pos.symbol]
                        : pos.stopLoss;

                    const tgtVal =
                      editingTarget[pos.symbol] !== undefined
                        ? editingTarget[pos.symbol]
                        : pos.target;

                    const currentLtp = Number(pos.ltp || 0);
                    const hasValidQuote = currentLtp > 0;

                    return (
                      <tr key={pos.id || pos.symbol} className="live-tr-row">
                        {/* 1. Instrument & Exchange */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>
                                {pos.symbol}
                              </span>
                              <span className={`status-pill ${pos.status === 'PARTIALLY_SQUARED' ? 'pill-orange' : 'pill-blue'}`}>
                                {pos.status === 'PARTIALLY_SQUARED' ? 'Partial Square' : 'Open'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                              <span>{pos.exchange}</span>·
                              <span>{pos.segment}</span>·
                              <span>{pos.productType}</span>
                            </div>
                          </div>
                        </td>

                        {/* 2. Direction & Quantity */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span
                              className="mono"
                              style={{
                                fontWeight: 600,
                                color: isLong ? '#10b981' : '#ef4444',
                              }}
                            >
                              {isLong ? 'BUY (Long)' : 'SELL (Short)'}
                            </span>
                            <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                              {pos.openQuantity} Qty
                            </span>
                          </div>
                        </td>

                        {/* 3. Avg Entry Price */}
                        <td>
                          <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                            ₹{Number(pos.averagePrice).toFixed(2)}
                          </span>
                        </td>

                        {/* 4. Current / Valid Price with Freshness Badge & Timestamp */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div className={`live-ltp-cell ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}>
                              <span className="mono live-ltp-text">
                                {hasValidQuote ? `₹${currentLtp.toFixed(2)}` : 'Unavailable'}
                              </span>
                              {flash === 'up' && <ArrowUpRight size={14} className="tick-arrow up" />}
                              {flash === 'down' && <ArrowDownRight size={14} className="tick-arrow down" />}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              {renderQuoteFreshnessBadge(pos.quoteFreshness || (pos.isMarketClosed ? 'MARKET CLOSED' : (isConnected ? 'LIVE' : 'UNAVAILABLE')))}
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {pos.quoteTime ? new Date(pos.quoteTime).toLocaleTimeString() : (lastTickTime ? new Date(lastTickTime).toLocaleTimeString() : '—')}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* 5. Market Value & Invested Capital */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                              {formatINR(pos.marketValue || (pos.openQuantity * (currentLtp || pos.averagePrice)))}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Invested: {formatINR(pos.investedCapital || (pos.openQuantity * pos.averagePrice))}
                            </span>
                          </div>
                        </td>

                        {/* 6. Breakeven Price & Distance */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="mono" style={{ fontWeight: 600, color: '#f59e0b' }}>
                              ₹{Number(pos.breakevenPrice).toFixed(2)}
                            </span>
                            <span
                              className={`be-distance-badge ${pos.isAboveBreakeven ? 'be-above' : 'be-below'}`}
                            >
                              {pos.isAboveBreakeven ? '+' : ''}
                              {pos.distanceToBreakeven} ({pos.distanceToBreakevenPct}%)
                            </span>
                          </div>
                        </td>

                        {/* 6. Stop Loss & Risk Amount */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>SL:</span>
                              <input
                                type="number"
                                step="0.05"
                                className="live-sl-input"
                                value={slVal}
                                onChange={(e) =>
                                  setEditingSL({ ...editingSL, [pos.symbol]: e.target.value })
                                }
                              />
                            </div>
                            <span className="mono" style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>
                              Risk: {formatINR(pos.riskAmount)}
                            </span>
                          </div>
                        </td>

                        {/* 7. Target & Live Risk / Reward */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tgt:</span>
                              <input
                                type="number"
                                step="0.05"
                                className="live-sl-input"
                                value={tgtVal}
                                onChange={(e) =>
                                  setEditingTarget({ ...editingTarget, [pos.symbol]: e.target.value })
                                }
                              />
                            </div>
                            <span className="mono" style={{ color: '#a78bfa', fontSize: 12, fontWeight: 600 }}>
                              R:R {pos.liveRiskRewardText}
                            </span>
                          </div>
                        </td>

                        {/* 8. Total Charges (Combined) */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                            <span className="mono" style={{ fontWeight: 600, color: '#fbbf24' }}>
                              {formatINR(pos.charges?.total)}
                            </span>
                            <button
                              className="charges-pill-btn"
                              onClick={() => setSelectedChargesPosition(pos)}
                              title="Click to view all 8 statutory & broker charges"
                            >
                              8 charges breakdown
                            </button>
                          </div>
                        </td>

                        {/* 9. Gross P&L */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span
                              className={`mono ${isProfitable ? 'text-emerald' : 'text-rose'}`}
                              style={{ fontWeight: 600, fontSize: 14 }}
                            >
                              {formatINR(pos.grossPnL)}
                            </span>
                            <span
                              className="mono"
                              style={{ fontSize: 11, color: isProfitable ? '#34d399' : '#f87171' }}
                            >
                              {pos.pnlPercentage > 0 ? '+' : ''}
                              {pos.pnlPercentage}%
                            </span>
                          </div>
                        </td>

                        {/* 10. Net P&L */}
                        <td>
                          <div className={`net-pnl-pill ${isNetProfitable ? 'net-profit' : 'net-loss'}`}>
                            <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                              {formatINR(pos.netPnL)}
                            </span>
                          </div>
                        </td>

                        {/* 11. Action (Update Risk) */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleSaveRisk(pos)}
                            title="Apply new Stop Loss / Target to calculations"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                          >
                            Update
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: FULLY SQUARED POSITIONS */}
        {activeTab === 'squared' && (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Exchange</th>
                  <th>Segment</th>
                  <th>Total Matched Qty</th>
                  <th>Buy Turnover</th>
                  <th>Sell Turnover</th>
                  <th>Realized Gross P&amp;L</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {squaredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No fully squared-off positions recorded yet.
                    </td>
                  </tr>
                ) : (
                  squaredPositions.map((p, idx) => (
                    <tr key={p.key || idx}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.symbol}</td>
                      <td>{p.exchange}</td>
                      <td>{p.segment}</td>
                      <td className="mono">{p.totalBuyQuantity}</td>
                      <td className="mono">₹{Number(p.totalBuyValue || 0).toLocaleString('en-IN')}</td>
                      <td className="mono">₹{Number(p.totalSellValue || 0).toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ color: p.realizedPnL >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {formatINR(p.realizedPnL)}
                      </td>
                      <td>
                        <span className="status-pill pill-green">Fully Squared</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: POSITION ENGINE STATUS */}
        {activeTab === 'engine' && (
          <div style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={18} style={{ color: '#38bdf8' }} />
              Position Engine Execution &amp; Matching Pipeline
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              The Position Engine monitors executed fills from Upstox, groups trades by contract, and applies first-in-first-out (FIFO) matching to isolate open lots and calculate realized P&amp;L.
            </p>

            <div className="engine-flow-diagram">
              <div className="engine-step">
                <span className="engine-step-badge">1</span>
                <strong>Broker Orders / Trades</strong>
                <p>Fetched from Upstox API &amp; stored in TradeGuard DB</p>
              </div>
              <div className="engine-arrow">➔</div>
              <div className="engine-step">
                <span className="engine-step-badge">2</span>
                <strong>FIFO Matching Engine</strong>
                <p>Buy/Sell order pairing, partial squares &amp; fully squared separation</p>
              </div>
              <div className="engine-arrow">➔</div>
              <div className="engine-step">
                <span className="engine-step-badge">3</span>
                <strong>Open Positions</strong>
                <p>Dispatched to Market Data Engine &amp; P&amp;L Engine</p>
              </div>
              <div className="engine-arrow">➔</div>
              <div className="engine-step">
                <span className="engine-step-badge">4</span>
                <strong>Live WebSocket</strong>
                <p>Streams live calculations to React UI</p>
              </div>
            </div>

            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div className="mini-engine-card">
                <strong>Active Open Positions</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: '#38bdf8' }}>
                  {positions.length}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Currently being priced live by Market Data Engine
                </span>
              </div>
              <div className="mini-engine-card">
                <strong>Fully Squared Contracts</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: '#10b981' }}>
                  {squaredPositions.length}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Complete round-trips with finalized realized P&amp;L
                </span>
              </div>
              <div className="mini-engine-card">
                <strong>Total Matched Trades Realized</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: portfolioSummary.totalRealizedPnL >= 0 ? '#10b981' : '#ef4444' }}>
                  {formatINR(portfolioSummary.totalRealizedPnL)}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Accumulated realized profit from squared lots
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: Individual Position Charges Breakdown */}
      {selectedChargesPosition && (
        <div className="modal-backdrop" onClick={() => setSelectedChargesPosition(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>
                  Combined Charges: {selectedChargesPosition.symbol}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {selectedChargesPosition.exchange} · {selectedChargesPosition.segment} · {selectedChargesPosition.productType}
                </span>
              </div>
              <button className="icon-btn" onClick={() => setSelectedChargesPosition(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                All 8 mandatory statutory &amp; broker fees are calculated and combined into the total charge per position:
              </p>

              <table className="breakdown-table">
                <tbody>
                  <tr>
                    <td>1. Brokerage (Upstox)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.brokerage)}</td>
                  </tr>
                  <tr>
                    <td>2. STT (Securities Transaction Tax)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.stt)}</td>
                  </tr>
                  <tr>
                    <td>3. GST (18% on Brokerage + Exchange + SEBI)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.gst)}</td>
                  </tr>
                  <tr>
                    <td>4. EXCHANGE CHARGES (NSE / BSE)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.exchangeCharges)}</td>
                  </tr>
                  <tr>
                    <td>5. CTT (Commodities Transaction Tax)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.ctt)}</td>
                  </tr>
                  <tr>
                    <td>6. SEBI CHARGES (₹10 per crore turnover)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.sebiCharges)}</td>
                  </tr>
                  <tr>
                    <td>7. STAMP DUTY (Charged on Buy Turnover)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.stampDuty)}</td>
                  </tr>
                  <tr>
                    <td>8. DP CHARGES (Depository sell fee)</td>
                    <td className="mono">{formatINR(selectedChargesPosition.charges?.dpCharges)}</td>
                  </tr>
                  <tr className="breakdown-total-row">
                    <td>
                      <strong>COMBINED TOTAL CHARGE</strong>
                    </td>
                    <td className="mono" style={{ color: '#fbbf24', fontSize: 16 }}>
                      <strong>{formatINR(selectedChargesPosition.charges?.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="breakeven-calc-box" style={{ marginTop: 16 }}>
                <strong>Breakeven Impact:</strong>
                <p style={{ fontSize: 12, margin: '4px 0 0 0', color: 'var(--text-secondary)' }}>
                  Total charges of {formatINR(selectedChargesPosition.charges?.total)} across {selectedChargesPosition.openQuantity} shares require a price move of{' '}
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                    ₹{selectedChargesPosition.charges?.chargesPerUnit} per share
                  </span>{' '}
                  to breakeven at <strong>₹{selectedChargesPosition.breakevenPrice}</strong>.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedChargesPosition(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Portfolio Total Combined Charges Breakdown */}
      {showPortfolioChargesModal && (
        <div className="modal-backdrop" onClick={() => setShowPortfolioChargesModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Portfolio Total Charges Breakdown</h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Combined across all {positions.length} open position(s)
                </span>
              </div>
              <button className="icon-btn" onClick={() => setShowPortfolioChargesModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <table className="breakdown-table">
                <tbody>
                  <tr>
                    <td>1. Brokerage</td>
                    <td className="mono">{formatINR(charges.brokerage)}</td>
                  </tr>
                  <tr>
                    <td>2. STT (Securities Transaction Tax)</td>
                    <td className="mono">{formatINR(charges.stt)}</td>
                  </tr>
                  <tr>
                    <td>3. GST (18%)</td>
                    <td className="mono">{formatINR(charges.gst)}</td>
                  </tr>
                  <tr>
                    <td>4. EXCHANGE CHARGES</td>
                    <td className="mono">{formatINR(charges.exchangeCharges)}</td>
                  </tr>
                  <tr>
                    <td>5. CTT (Commodities Transaction Tax)</td>
                    <td className="mono">{formatINR(charges.ctt)}</td>
                  </tr>
                  <tr>
                    <td>6. SEBI CHARGES</td>
                    <td className="mono">{formatINR(charges.sebiCharges)}</td>
                  </tr>
                  <tr>
                    <td>7. STAMP DUTY</td>
                    <td className="mono">{formatINR(charges.stampDuty)}</td>
                  </tr>
                  <tr>
                    <td>8. DP CHARGES</td>
                    <td className="mono">{formatINR(charges.dpCharges)}</td>
                  </tr>
                  <tr className="breakdown-total-row">
                    <td>
                      <strong>COMBINED TOTAL CHARGES</strong>
                    </td>
                    <td className="mono" style={{ color: '#fbbf24', fontSize: 16 }}>
                      <strong>{formatINR(charges.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPortfolioChargesModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
