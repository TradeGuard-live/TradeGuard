import React, { useState } from 'react';
import { useLiveTrading } from '../hooks/useLiveTrading';
import { api } from '../api/client';
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
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
  LogOut,
  AlertOctagon,
  Check,
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
  const normalized = String(status || '').toUpperCase().replace(/_/g, ' ');
  switch (normalized) {
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

// ✅ Renders which broker's WebSocket or feed this price quote is streaming from
function renderQuoteSourceBadge(source) {
  const s = String(source || '').toUpperCase();
  if (s.includes('UPSTOX_WS')) {
    return (
      <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
        Upstox WS
      </span>
    );
  }
  if (s.includes('DHAN')) {
    return (
      <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
        Dhan Ticker
      </span>
    );
  }
  if (s.includes('ANGEL')) {
    return (
      <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
        Angel One WS
      </span>
    );
  }
  if (s.includes('KOTAK')) {
    return (
      <span className="badge" style={{ background: 'rgba(236, 72, 153, 0.12)', color: '#f472b6', border: '1px solid rgba(236, 72, 153, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec4899', display: 'inline-block' }} />
        Kotak Neo Feed
      </span>
    );
  }
  if (s.includes('REST')) {
    return (
      <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
        REST Snapshot
      </span>
    );
  }
  if (s.includes('BROKER_POSITION')) {
    return (
      <span className="badge" style={{ background: 'rgba(156, 163, 175, 0.12)', color: '#9ca3af', border: '1px solid rgba(156, 163, 175, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />
        Broker Position
      </span>
    );
  }
  return (
    <span className="badge" style={{ background: 'rgba(107, 114, 128, 0.12)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.25)', fontSize: 11, padding: '3px 7px', borderRadius: 6, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b7280', display: 'inline-block' }} />
      Standby
    </span>
  );
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
    reconnect,
  } = useLiveTrading();

  const [selectedChargesPosition, setSelectedChargesPosition] = useState(null);
  const [showPortfolioChargesModal, setShowPortfolioChargesModal] = useState(false);
  const [editingSL, setEditingSL] = useState({}); // { [symbol]: stopLossValue }
  const [editingTarget, setEditingTarget] = useState({}); // { [symbol]: targetValue }
  const [activeTab, setActiveTab] = useState('open'); // 'open' | 'squared' | 'engine'

  // Single Position Exit State
  const [exitPositionTarget, setExitPositionTarget] = useState(null);
  const [exitOrderType, setExitOrderType] = useState('MARKET'); // 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
  const [exitQuantity, setExitQuantity] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [exitTriggerPrice, setExitTriggerPrice] = useState('');
  const [exitProductType, setExitProductType] = useState('INTRADAY');
  const [exitSubmitting, setExitSubmitting] = useState(false);
  const [exitError, setExitError] = useState(null);
  const [exitSuccess, setExitSuccess] = useState(null);

  // Bulk Square-Off (Exit All Positions) State
  const [showExitAllModal, setShowExitAllModal] = useState(false);
  const [exitAllOrderType, setExitAllOrderType] = useState('MARKET'); // 'MARKET' | 'LIMIT'
  const [exitAllSubmitting, setExitAllSubmitting] = useState(false);
  const [exitAllError, setExitAllError] = useState(null);
  const [exitAllResult, setExitAllResult] = useState(null);

  const handleOpenExitModal = (pos) => {
    setExitPositionTarget(pos);
    setExitOrderType('MARKET');
    setExitQuantity(String(Math.abs(pos.openQuantity || 1)));
    setExitPrice(String(pos.ltp || pos.averagePrice || ''));
    const defaultTrigger = pos.stopLoss != null
      ? Number(pos.stopLoss)
      : Number(((pos.ltp || pos.averagePrice || 100) * (pos.side === 'BUY' ? 0.99 : 1.01)).toFixed(2));
    setExitTriggerPrice(String(defaultTrigger));
    setExitProductType(pos.productType || 'INTRADAY');
    setExitError(null);
    setExitSuccess(null);
  };

  const handleConfirmExit = async () => {
    if (!exitPositionTarget) return;
    setExitSubmitting(true);
    setExitError(null);
    setExitSuccess(null);

    try {
      const payload = {
        positionKey: exitPositionTarget.key || exitPositionTarget.id,
        symbol: exitPositionTarget.symbol,
        exchange: exitPositionTarget.exchange,
        segment: exitPositionTarget.segment,
        productType: exitProductType,
        broker: exitPositionTarget.broker,
        brokerAccountId: exitPositionTarget.brokerAccountId,
        securityId: exitPositionTarget.securityId,
        instrumentToken: exitPositionTarget.instrumentToken,
        orderType: exitOrderType,
        quantity: Number(exitQuantity),
        price: Number(exitPrice || 0),
        triggerPrice: Number(exitTriggerPrice || 0)
      };

      const res = await api.exitPosition(payload);
      setExitSuccess(res.message || `Exit order placed for ${exitPositionTarget.symbol}`);
      setTimeout(() => {
        setExitPositionTarget(null);
        setExitSuccess(null);
      }, 1500);
    } catch (err) {
      setExitError(err.message || 'Failed to exit position');
    } finally {
      setExitSubmitting(false);
    }
  };

  const handleConfirmExitAll = async () => {
    if (positions.length === 0) return;
    setExitAllSubmitting(true);
    setExitAllError(null);
    setExitAllResult(null);

    try {
      const res = await api.exitAllPositions({
        orderType: exitAllOrderType,
        positions
      });
      setExitAllResult(res);
      setTimeout(() => {
        setShowExitAllModal(false);
        setExitAllResult(null);
      }, 2000);
    } catch (err) {
      setExitAllError(err.message || 'Failed to square off all positions');
    } finally {
      setExitAllSubmitting(false);
    }
  };

  const handleSaveRisk = (pos) => {
    const symbol = pos.symbol;
    const sl = editingSL[symbol] !== undefined ? editingSL[symbol] : (pos.stopLoss != null ? pos.stopLoss : '');
    const tgt = editingTarget[symbol] !== undefined ? editingTarget[symbol] : (pos.target != null ? pos.target : '');
    const slNum = sl === '' || sl == null ? null : Number(sl);
    const tgtNum = tgt === '' || tgt == null ? null : Number(tgt);
    updateSLTarget(symbol, slNum, tgtNum);
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

          {/* ✅ Real-time automatic order & tick sync via WebSocket */}
          <div
            className="live-clock-badge"
            style={{
              background: 'rgba(99, 102, 241, 0.08)',
              borderColor: 'rgba(99, 102, 241, 0.25)',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              padding: '6px 11px',
              borderRadius: 8,
              fontWeight: 500
            }}
            title="Automatic real-time WebSocket streaming for broker fills, order executions, and live ticks"
          >
            <Activity size={13} style={{ color: '#818cf8' }} />
            <span>Auto-Stream Active</span>
          </div>

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
          <div
            className="live-card-value"
            style={{
              color:
                portfolioSummary.portfolioRiskRewardText &&
                portfolioSummary.portfolioRiskRewardText !== 'Not Set' &&
                portfolioSummary.portfolioRiskRewardText !== '—'
                  ? '#c4b5fd'
                  : 'var(--text-muted)',
            }}
          >
            {portfolioSummary.portfolioRiskRewardText &&
            portfolioSummary.portfolioRiskRewardText !== 'Not Set' &&
            portfolioSummary.portfolioRiskRewardText !== '—'
              ? portfolioSummary.portfolioRiskRewardText
              : '—'}
          </div>
          <div className="live-card-sub">
            <span>
              {portfolioSummary.totalRiskAmount > 0
                ? `Risk: ${formatINR(portfolioSummary.totalRiskAmount)}`
                : 'No Stop Loss set'}
            </span>
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
            {activeTab === 'open' && positions.length > 0 && (
              <button
                className="btn btn-danger"
                onClick={() => setShowExitAllModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  cursor: 'pointer'
                }}
                title="Square off all currently open positions across all connected brokers"
              >
                <AlertOctagon size={14} />
                <span>Exit All Positions ({positions.length})</span>
              </button>
            )}
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
                  <th>Avg Price</th>
                  <th>Current / Valid Price</th>
                  <th>Feed / Broker WS</th>
                  <th>Entry Price</th>
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
                    <td colSpan={13} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                      No active open positions. Sync your broker account or execute a trade to view real-time data.
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
                        : (pos.stopLoss != null ? pos.stopLoss : '');

                    const tgtVal =
                      editingTarget[pos.symbol] !== undefined
                        ? editingTarget[pos.symbol]
                        : (pos.target != null ? pos.target : '');

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

                        {/* 5. Feed / Broker WebSocket Source */}
                        <td>
                          {renderQuoteSourceBadge(pos.quoteSource)}
                        </td>

                        {/* 6. Entry Price (Execution Price) */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                              ₹{Number(pos.entryPrice || pos.averagePrice || 0).toFixed(2)}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Execution Price
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
                                placeholder="Not set"
                                value={slVal}
                                onChange={(e) =>
                                  setEditingSL({ ...editingSL, [pos.symbol]: e.target.value })
                                }
                              />
                            </div>
                            <span
                              className="mono"
                              style={{
                                color: pos.stopLoss != null && pos.riskAmount != null ? '#f87171' : 'var(--text-muted)',
                                fontSize: 12,
                                fontWeight: pos.stopLoss != null ? 600 : 400,
                              }}
                            >
                              {pos.stopLoss != null && pos.riskAmount != null
                                ? `Risk: ${formatINR(pos.riskAmount)}`
                                : 'Risk: Not Set'}
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
                                placeholder="Not set"
                                value={tgtVal}
                                onChange={(e) =>
                                  setEditingTarget({ ...editingTarget, [pos.symbol]: e.target.value })
                                }
                              />
                            </div>
                            <span
                              className="mono"
                              style={{
                                color:
                                  pos.liveRiskRewardText &&
                                  pos.liveRiskRewardText !== 'Not Set' &&
                                  pos.liveRiskRewardText !== '—'
                                    ? '#a78bfa'
                                    : 'var(--text-muted)',
                                fontSize: 12,
                                fontWeight:
                                  pos.liveRiskRewardText &&
                                  pos.liveRiskRewardText !== 'Not Set' &&
                                  pos.liveRiskRewardText !== '—'
                                    ? 600
                                    : 400,
                              }}
                            >
                              {pos.liveRiskRewardText &&
                              pos.liveRiskRewardText !== 'Not Set' &&
                              pos.liveRiskRewardText !== '—'
                                ? `R:R ${pos.liveRiskRewardText}`
                                : 'R:R: Not Set'}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                              <span>MTM: {formatINR(pos.unrealizedGrossPnL != null ? pos.unrealizedGrossPnL : pos.grossPnL)}</span>
                              {pos.realizedGrossPnL ? (
                                <span>· Realized: {formatINR(pos.realizedGrossPnL)}</span>
                              ) : null}
                            </div>
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

                        {/* 11. Action (Update Risk & Exit Position) */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleSaveRisk(pos)}
                              title="Apply new Stop Loss / Target to calculations"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                            >
                              Update
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleOpenExitModal(pos)}
                              title="Exit / Square off this position"
                              style={{
                                padding: '4px 8px',
                                fontSize: 11,
                                fontWeight: 600,
                                background: 'rgba(239, 68, 68, 0.12)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: 6,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3
                              }}
                            >
                              <LogOut size={12} />
                              <span>Exit</span>
                            </button>
                          </div>
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
      {/* MODAL 3: Exit Position Modal */}
      {exitPositionTarget && (
        <div className="modal-backdrop" onClick={() => !exitSubmitting && setExitPositionTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#f87171'
                }}>
                  <LogOut size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17 }}>Exit Position: {exitPositionTarget.symbol}</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {exitPositionTarget.broker && (
                      <span style={{
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                        fontSize: 11,
                        marginRight: 6
                      }}>
                        {exitPositionTarget.broker}
                      </span>
                    )}
                    {exitPositionTarget.exchange} · {exitPositionTarget.segment} · {exitPositionTarget.productType}
                  </span>
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => !exitSubmitting && setExitPositionTarget(null)}
                disabled={exitSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Position Overview Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 12
              }}>
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Side</span>
                  <div style={{ fontWeight: 600, color: exitPositionTarget.side === 'BUY' ? '#10b981' : '#ef4444' }}>
                    {exitPositionTarget.side === 'BUY' ? 'LONG' : 'SHORT'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Open Qty</span>
                  <div className="mono" style={{ fontWeight: 600 }}>{exitPositionTarget.openQuantity}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Entry Avg</span>
                  <div className="mono" style={{ fontWeight: 600 }}>₹{Number(exitPositionTarget.averagePrice).toFixed(2)}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current LTP</span>
                  <div className="mono" style={{ fontWeight: 600, color: '#38bdf8' }}>
                    ₹{Number(exitPositionTarget.ltp || exitPositionTarget.averagePrice).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Action Banner */}
              <div style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: exitPositionTarget.side === 'BUY' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                color: exitPositionTarget.side === 'BUY' ? '#f87171' : '#34d399',
                border: `1px solid ${exitPositionTarget.side === 'BUY' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`
              }}>
                <Zap size={14} />
                <span>
                  Exiting {exitPositionTarget.side === 'BUY' ? 'Long' : 'Short'} position will place a{' '}
                  <strong>{exitPositionTarget.side === 'BUY' ? 'SELL' : 'BUY'}</strong> order on{' '}
                  <strong>{exitPositionTarget.broker ? `${exitPositionTarget.broker} (${exitPositionTarget.exchange})` : exitPositionTarget.exchange}</strong>
                </span>
              </div>

              {/* Order Type Selector */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Exit Order Type
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[
                    { id: 'MARKET', label: 'Market', desc: 'At current price' },
                    { id: 'LIMIT', label: 'Limit', desc: 'Specific limit price' },
                    { id: 'SL', label: 'SL (Limit)', desc: 'Stop loss limit' },
                    { id: 'SL-M', label: 'SL-M', desc: 'Stop loss market' },
                  ].map((ot) => (
                    <button
                      key={ot.id}
                      type="button"
                      onClick={() => setExitOrderType(ot.id)}
                      style={{
                        padding: '8px 6px',
                        borderRadius: 6,
                        border: `1px solid ${exitOrderType === ot.id ? 'var(--primary-color)' : 'var(--border-color)'}`,
                        background: exitOrderType === ot.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                        color: exitOrderType === ot.id ? '#818cf8' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{ot.label}</span>
                      <span style={{ fontSize: 9, opacity: 0.8 }}>{ot.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity Input with Presets */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Quantity to Exit
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Max: {Math.abs(exitPositionTarget.openQuantity)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    min="1"
                    max={Math.abs(exitPositionTarget.openQuantity)}
                    className="form-control"
                    value={exitQuantity}
                    onChange={(e) => setExitQuantity(e.target.value)}
                    style={{ flex: 1, padding: '8px 12px', fontSize: 14 }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => {
                          const maxQ = Math.abs(exitPositionTarget.openQuantity);
                          const calculated = Math.max(1, Math.floor((maxQ * pct) / 100));
                          setExitQuantity(String(calculated));
                        }}
                      >
                        {pct === 100 ? 'All' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Price Inputs (Conditional on Order Type) */}
              <div style={{ display: 'grid', gridTemplateColumns: exitOrderType === 'SL' ? '1fr 1fr' : '1fr', gap: 12 }}>
                {(exitOrderType === 'LIMIT' || exitOrderType === 'SL') && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                      Limit Price (₹)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      className="form-control"
                      value={exitPrice}
                      onChange={(e) => setExitPrice(e.target.value)}
                      placeholder="Enter limit price"
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                )}

                {(exitOrderType === 'SL' || exitOrderType === 'SL-M') && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                      Trigger Price (₹)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      className="form-control"
                      value={exitTriggerPrice}
                      onChange={(e) => setExitTriggerPrice(e.target.value)}
                      placeholder="Enter trigger price"
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    />
                  </div>
                )}
              </div>

              {/* Product Type Selector */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Product Type
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['INTRADAY', 'DELIVERY', 'NRML'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setExitProductType(p)}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: `1px solid ${exitProductType === p ? 'var(--primary-color)' : 'var(--border-color)'}`,
                        background: exitProductType === p ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                        color: exitProductType === p ? '#818cf8' : 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      {p === 'DELIVERY' ? 'CNC / Delivery' : p === 'INTRADAY' ? 'MIS / Intraday' : 'NRML / Carry'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error & Success Banners */}
              {exitError && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <AlertCircle size={15} />
                  <span>{exitError}</span>
                </div>
              )}

              {exitSuccess && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <CheckCircle2 size={15} />
                  <span>{exitSuccess}</span>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setExitPositionTarget(null)}
                disabled={exitSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmExit}
                disabled={exitSubmitting || !exitQuantity || Number(exitQuantity) <= 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 600
                }}
              >
                {exitSubmitting ? (
                  <>
                    <span className="spinner-rotate" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    <span>Placing Exit Order...</span>
                  </>
                ) : (
                  <>
                    <LogOut size={14} />
                    <span>Confirm Exit ({exitOrderType})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Exit All Positions (Square Off All) Modal */}
      {showExitAllModal && (
        <div className="modal-backdrop" onClick={() => !exitAllSubmitting && setShowExitAllModal(false)}>
          <div className="modal-box" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#f87171'
                }}>
                  <AlertOctagon size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17 }}>Square Off All Positions</h3>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Exits all {positions.length} currently open positions across all connected brokers
                  </span>
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => !exitAllSubmitting && setShowExitAllModal(false)}
                disabled={exitAllSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Alert Notice */}
              <div style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: 13,
                lineHeight: 1.4
              }}>
                <strong>⚠️ Warning:</strong> This will send immediate exit orders for all {positions.length} open positions.
                Positions will be squared off at market or specified prices, and will be reconciled in real time.
              </div>

              {/* Order Type Choice for Bulk Square Off */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Execution Order Type for All Positions
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setExitAllOrderType('MARKET')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px solid ${exitAllOrderType === 'MARKET' ? '#dc2626' : 'var(--border-color)'}`,
                      background: exitAllOrderType === 'MARKET' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                      color: exitAllOrderType === 'MARKET' ? '#f87171' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>MARKET (Recommended)</div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>Instant execution at best prevailing market prices</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExitAllOrderType('LIMIT')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px solid ${exitAllOrderType === 'LIMIT' ? '#dc2626' : 'var(--border-color)'}`,
                      background: exitAllOrderType === 'LIMIT' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                      color: exitAllOrderType === 'LIMIT' ? '#f87171' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>LIMIT (At Current LTP)</div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>Places limit orders matching each instrument's current LTP</div>
                  </button>
                </div>
              </div>

              {/* List of Positions being squared off */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Positions to be Exited ({positions.length})
                </label>
                <div style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8
                }}>
                  <table className="breakdown-table" style={{ margin: 0, width: '100%' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255, 255, 255, 0.04)', fontSize: 11, color: 'var(--text-muted)' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left' }}>Instrument</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left' }}>Action</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>LTP</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Net P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => {
                        const exitAction = p.side === 'BUY' ? 'SELL' : 'BUY';
                        return (
                          <tr key={p.id || p.symbol} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.symbol}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.exchange} · {p.productType}</div>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: exitAction === 'SELL' ? '#f87171' : '#34d399',
                                background: exitAction === 'SELL' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                padding: '2px 6px',
                                borderRadius: 4
                              }}>
                                {exitAction}
                              </span>
                            </td>
                            <td className="mono" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                              {p.openQuantity}
                            </td>
                            <td className="mono" style={{ padding: '8px 10px', textAlign: 'right' }}>
                              ₹{Number(p.ltp || p.averagePrice).toFixed(2)}
                            </td>
                            <td className="mono" style={{
                              padding: '8px 10px',
                              textAlign: 'right',
                              fontWeight: 600,
                              color: p.netPnL >= 0 ? '#10b981' : '#ef4444'
                            }}>
                              {formatINR(p.netPnL)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Error & Result Notices */}
              {exitAllError && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <AlertCircle size={15} />
                  <span>{exitAllError}</span>
                </div>
              )}

              {exitAllResult && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <CheckCircle2 size={15} />
                  <span>{exitAllResult.message}</span>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowExitAllModal(false)}
                disabled={exitAllSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmExitAll}
                disabled={exitAllSubmitting || positions.length === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#dc2626',
                  color: '#ffffff',
                  fontWeight: 600
                }}
              >
                {exitAllSubmitting ? (
                  <>
                    <span className="spinner-rotate" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    <span>Squaring Off All...</span>
                  </>
                ) : (
                  <>
                    <AlertOctagon size={14} />
                    <span>Confirm Square Off All ({positions.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
