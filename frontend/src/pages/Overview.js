import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, StatCard } from '../components/Card';
import { Info, X, Zap, Activity, ShieldAlert, ArrowRight, Receipt, Scale, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useLiveTrading } from '../hooks/useLiveTrading';
import DonutChart from '../components/charts/DonutChart';
import LineChart from '../components/charts/LineChart';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];

function formatINR(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function getTradeDate(trade) {
  return trade.tradeTime || trade.executedAt || trade.createdAt || trade.updatedAt || null;
}

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

function formatTime(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getId(trade) {
  return trade._id || trade.tradeId || trade.orderId || 'Execution';
}

function getQuantity(trade) {
  return trade.quantity ?? '—';
}

function getPrice(trade) {
  return trade.executedPrice ?? trade.averagePrice ?? trade.price;
}

export default function Overview() {
  const liveData = useLiveTrading();
  const [range, setRange] = useState('all');
  const [drawerTrade, setDrawerTrade] = useState(null);
  const [showBanner, setShowBanner] = useState(true);

  const [summary, setSummary] = useState(null);
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [instrumentDistribution, setInstrumentDistribution] = useState([]);
  const [equitySeries, setEquitySeries] = useState([]);
  const [equityLoading, setEquityLoading] = useState(false);
  const [riskData, setRiskData] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setError('');

      try {
        const [summaryResponse, tradesResponse, accountsResponse, instrumentResponse, riskResponse] =
          await Promise.all([
            api.tradeSummary(),
            api.listTrades(),
            api.listBrokerAccounts(),
            api.instrumentDistribution(),
            api.riskExposures(),
          ]);

        if (!active) return;

        setSummary(summaryResponse?.data || null);
        setTrades(
          Array.isArray(tradesResponse?.data) ? tradesResponse.data : []
        );
        setAccounts(
          Array.isArray(accountsResponse?.data) ? accountsResponse.data : []
        );
        setInstrumentDistribution(instrumentResponse?.data?.distribution || []);
        setRiskData(riskResponse?.data || null);
      } catch (err) {
        if (active) {
          setError(
            err?.response?.data?.message ||
              err?.message ||
              'Unable to load your saved trading data.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadOverview();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadEquity() {
      setEquityLoading(true);
      try {
        const res = await api.tradeAnalytics(range);
        if (active && res?.data?.equitySeries) {
          setEquitySeries(res.data.equitySeries);
        }
      } catch {
        // Fallback: silently retain previous curve
      } finally {
        if (active) setEquityLoading(false);
      }
    }

    loadEquity();

    return () => {
      active = false;
    };
  }, [range]);

  // Apply the selected date range to the execution list.
  // The summary cards below remain all-time totals returned by the API.
  const filteredTrades = useMemo(() => {
    const now = new Date();
    const isAll = range === 'all';
    const days = range === '7d' ? 7 : range === '90d' ? 90 : range === '1y' ? 365 : isAll ? null : 30;
    const cutoff = days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null;

    return trades
      .filter((trade) => {
        const value = getTradeDate(trade);
        if (!value) return false;

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return false;
        if (!isAll && cutoff && date < cutoff) return false;
        return date <= now;
      })
      .sort((a, b) => {
        const dateA = new Date(getTradeDate(a) || 0).getTime();
        const dateB = new Date(getTradeDate(b) || 0).getTime();
        return dateB - dateA;
      });
  }, [trades, range]);

  const recent = filteredTrades.slice(0, 5);

  const totalExecutions =
    summary?.totalExecutions ?? trades.length;

  const buyExecutions =
    summary?.buyExecutions ??
    trades.filter((trade) => trade.transactionType === 'BUY').length;

  const sellExecutions =
    summary?.sellExecutions ??
    trades.filter((trade) => trade.transactionType === 'SELL').length;

  const totalQuantity =
    summary?.totalQuantity ??
    trades.reduce((total, trade) => total + Number(trade.quantity || 0), 0);

  const brokerAccountCount =
    summary?.brokerAccounts ?? accounts.length;

  const distinctSymbols =
    summary?.distinctSymbols ??
    new Set(trades.map((trade) => trade.symbol).filter(Boolean)).size;

  const riskPrefs = useMemo(() => {
    try {
      const stored = localStorage.getItem('tg_risk_prefs');
      return stored ? JSON.parse(stored) : { dailyLimit: 15000, riskPerTrade: 1.5, maxExposure: 100000 };
    } catch {
      return { dailyLimit: 15000, riskPerTrade: 1.5, maxExposure: 100000 };
    }
  }, []);

  const dailyLimit = Number(riskPrefs?.dailyLimit) || 15000;
  const todayPnL = Number(riskData?.todayPnL || 0);
  const todayLoss = Math.max(0, -todayPnL);
  const dailyLossPct = dailyLimit > 0 ? Math.min((todayLoss / dailyLimit) * 100, 100) : 0;
  const isBreached = todayLoss >= dailyLimit;
  const isWarning = dailyLossPct >= 70 && !isBreached;

  return (
    <>
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Portfolio overview</h1>
          <p className="page-description">
            A consolidated view of executions saved in your TradeGuard database.
          </p>
        </div>

        <select
          className="filter-select"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last 1 year</option>
        </select>
      </div>

      {/* Live Trading Ticker Bar */}
      <div className="overview-live-bar" style={{ marginBottom: 24 }}>
        <div className="overview-live-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`live-ws-pill ${liveData.isConnected ? 'connected' : 'connecting'}`}>
              <span className="live-ws-pulse" />
              {liveData.isConnected ? 'WebSocket Live' : 'Connecting WS...'}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>
              Live Trading Engine Feed
            </span>
          </div>

          <Link
            to="/app/live"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px' }}
          >
            <span>Open Terminal</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        <div className="overview-live-stats-row">
          <div className="overview-live-item">
            <span className="overview-live-label">Live Unrealized P&amp;L</span>
            <span
              className={`mono overview-live-val ${
                liveData.portfolioSummary.totalUnrealizedPnL >= 0 ? 'text-emerald' : 'text-rose'
              }`}
            >
              {formatINR(liveData.portfolioSummary.totalUnrealizedPnL)}
            </span>
          </div>

          <div className="overview-live-item">
            <span className="overview-live-label">Gross P&amp;L</span>
            <span
              className={`mono overview-live-val ${
                liveData.portfolioSummary.totalGrossPnL >= 0 ? 'text-emerald' : 'text-rose'
              }`}
            >
              {formatINR(liveData.portfolioSummary.totalGrossPnL)}
            </span>
          </div>

          <div className="overview-live-item">
            <span className="overview-live-label">Total Charges (8 Fees)</span>
            <span className="mono overview-live-val" style={{ color: '#fbbf24' }}>
              {formatINR(liveData.portfolioSummary.totalCharges?.total)}
            </span>
          </div>

          <div className="overview-live-item">
            <span className="overview-live-label">Net P&amp;L</span>
            <span
              className={`mono overview-live-val ${
                liveData.portfolioSummary.totalNetPnL >= 0 ? 'text-emerald' : 'text-rose'
              }`}
            >
              {formatINR(liveData.portfolioSummary.totalNetPnL)}
            </span>
          </div>

          <div className="overview-live-item">
            <span className="overview-live-label">Risk Amount (SL)</span>
            <span className="mono overview-live-val" style={{ color: '#f87171' }}>
              {formatINR(liveData.portfolioSummary.totalRiskAmount)}
            </span>
          </div>

          <div className="overview-live-item">
            <span className="overview-live-label">Live Risk / Reward</span>
            <span className="mono overview-live-val" style={{ color: '#c4b5fd' }}>
              {liveData.portfolioSummary.portfolioRiskRewardText || '1:2.0'}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="info-banner" role="alert">
          Could not load account data: {error}
        </div>
      )}

      {loading ? (
        <p>Loading your saved trading data…</p>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Saved executions"
              value={totalExecutions}
              change="All-time database total"
              changeType="neutral"
            />
            <StatCard
              label="Buy executions"
              value={buyExecutions}
              change="All-time database total"
              changeType="neutral"
            />
            <StatCard
              label="Sell executions"
              value={sellExecutions}
              change="All-time database total"
              changeType="neutral"
            />
            <StatCard
              label="Executed quantity"
              value={Number(totalQuantity).toLocaleString('en-IN')}
              change="All-time database total"
              changeType="neutral"
            />
            <StatCard
              label="Broker accounts"
              value={brokerAccountCount}
              change="Saved accounts"
              changeType="neutral"
            />
            <StatCard
              label="Symbols traded"
              value={distinctSymbols}
              change="Distinct saved symbols"
              changeType="neutral"
            />
          </div>

          <div className="grid-2" style={{ marginBottom: 20 }}>
            <Card
              title="Equity performance"
              subtitle={`Cumulative realized P&L curve for ${range === '7d' ? 'last 7 days' : range === '90d' ? 'last 90 days' : 'last 30 days'}`}
            >
              {equityLoading ? (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  Loading equity curve…
                </div>
              ) : equitySeries.length === 0 ? (
                <div
                  style={{
                    minHeight: 220,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    padding: 20,
                  }}
                >
                  No closed trades recorded in this period to plot equity curve.
                </div>
              ) : (
                <LineChart data={equitySeries} height={240} />
              )}
            </Card>

            <Card
              title="Instrument distribution"
              subtitle="Executed trades grouped by equity product, futures and options"
            >
              {instrumentDistribution.length === 0 ? (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No instrument classification available. Check saved segment/product fields.
                </div>
              ) : (
                <DonutChart
                  data={instrumentDistribution.map((item, index) => ({
                    label: item.label,
                    value: item.value,
                    color: CHART_COLORS[index % CHART_COLORS.length],
                  }))}
                  size={200}
                  thickness={28}
                />
              )}
            </Card>
          </div>

          <div className="grid-2">
            <Card
              title="Recent trades"
              subtitle={`Saved executions from the selected ${range} period. Select a row for details.`}
              padded={false}
            >
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Execution price</th>
                      <th>Broker</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recent.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
                          No saved executions found for this period.
                        </td>
                      </tr>
                    ) : (
                      recent.map((trade) => {
                        const tradeDate = getTradeDate(trade);
                        const side = trade.transactionType;

                        return (
                          <tr
                            key={trade._id || trade.tradeId || trade.orderId}
                            onClick={() => setDrawerTrade(trade)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <div className="text-primary">
                                {formatDate(tradeDate)}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {formatTime(tradeDate)}
                              </div>
                            </td>

                            <td>
                              <div className="text-primary">
                                {trade.symbol || '—'}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {trade.segment || trade.exchange || '—'}
                              </div>
                            </td>

                            <td>
                              <span
                                className={`badge ${
                                  side === 'BUY'
                                    ? 'badge-success'
                                    : side === 'SELL'
                                    ? 'badge-danger'
                                    : ''
                                }`}
                              >
                                {side || '—'}
                              </span>
                            </td>

                            <td className="text-right mono">
                              {getQuantity(trade)}
                            </td>

                            <td className="text-right mono">
                              {getPrice(trade) == null
                                ? '—'
                                : formatINR(getPrice(trade))}
                            </td>

                            <td>{trade.broker || '—'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card
              title="Risk summary &amp; Guardrails"
              subtitle="Active daily loss limit, exposure consumption, and circuit breaker status"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert size={16} color={isBreached ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--emerald)'} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Daily Loss Guardrail</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                      ₹{todayLoss.toLocaleString('en-IN')} / ₹{dailyLimit.toLocaleString('en-IN')}
                    </span>
                    <span className={`badge ${isBreached ? 'badge-danger' : isWarning ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 11 }}>
                      {isBreached ? 'Breached' : isWarning ? 'Caution' : 'Active & Safe'}
                    </span>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    <span>Daily loss used</span>
                    <span className="mono">{dailyLossPct.toFixed(1)}%</span>
                  </div>
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${dailyLossPct}%`,
                        background: isBreached ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--emerald)'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                  <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Historical Drawdown</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                      ₹{(riskData?.maxDrawdown || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div style={{ padding: '10px 12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Capital Exposed</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                      ₹{(riskData?.totalExposure || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <Link
                    to="/app/risk"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <span>Manage guardrails</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {drawerTrade && (
        <>
          <div
            className="drawer-overlay"
            onClick={() => setDrawerTrade(null)}
          />

          <div className="drawer">
            <div className="drawer-header">
              <div>
                <div
                  style={{ fontSize: 12, color: 'var(--text-muted)' }}
                >
                  Execution details
                </div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {getId(drawerTrade)}
                </div>
                <div
                  style={{ fontSize: 12, color: 'var(--text-muted)' }}
                >
                  Saved TradeGuard execution record
                </div>
              </div>

              <button
                className="icon-btn"
                aria-label="Close trade details"
                onClick={() => setDrawerTrade(null)}
              >
                <X size={18} />
              </button>
            </div>

            {[
              ['Symbol', drawerTrade.symbol],
              ['Broker', drawerTrade.broker],
              ['Side', drawerTrade.transactionType],
              ['Quantity', drawerTrade.quantity],
              [
                'Execution price',
                getPrice(drawerTrade) == null
                  ? '—'
                  : formatINR(getPrice(drawerTrade)),
              ],
              ['Order type', drawerTrade.orderType || 'MARKET'],
              ['Segment', drawerTrade.segment || drawerTrade.exchange || 'EQUITY'],
              ['Order ID', drawerTrade.orderId || ('ORD-' + (drawerTrade.tradeId || drawerTrade._id))],
              ['Trade ID', drawerTrade.tradeId || '—'],
              ['Status', drawerTrade.status],
              [
                'Executed / saved',
                getTradeDate(drawerTrade)
                  ? new Date(getTradeDate(drawerTrade)).toLocaleString('en-GB')
                  : '—',
              ],
            ].map(([label, value]) => (
              <div className="detail-row" key={label}>
                <span className="detail-label">{label}</span>
                <span className="detail-value">{value ?? '—'}</span>
              </div>
            ))}

            <div
              style={{
                marginTop: 20,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              Realized P&amp;L is not displayed for an individual execution.
              It must be calculated by matching relevant buy and sell fills
              using the selected accounting method.
            </div>
          </div>
        </>
      )}
    </>
  );
}