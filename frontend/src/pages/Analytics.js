import React, { useEffect, useState, useMemo } from 'react';
import { Card, StatCard } from '../components/Card';
import LineChart from '../components/charts/LineChart';
import { GroupedBarChart, SimpleBarChart } from '../components/charts/BarChart';
import { Calendar, Building2, Info, X } from 'lucide-react';
import { api } from '../api/client';
import { BROKER_META } from '../data/mockData';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 Days' },
  { id: '30d',   label: '30 Days' },
  { id: '90d',   label: '90 Days' },
  { id: '1y',    label: '1 Year' },
  { id: 'all',   label: 'All Time' },
];

export default function Analytics() {
  const [range, setRange] = useState('all');
  const [brokerFilter, setBrokerFilter] = useState('all');
  const [showBanner, setShowBanner] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      setLoading(true);
      setError('');
      try {
        const response = await api.tradeAnalytics(range, brokerFilter);
        if (active) {
          setData(response?.data || null);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Failed to load analytics');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnalytics();
    return () => { active = false; };
  }, [range, brokerFilter]);

  const brokerOptions = useMemo(() => {
    const from = data?.availableBrokers || [];
    const all  = from.length > 0 ? from : Object.keys(BROKER_META);
    return [{ id: 'all', label: 'All Brokers (Combined)' }, ...all.map(b => ({ id: b, label: BROKER_META[b]?.name || b }))];
  }, [data?.availableBrokers]);

  const equitySeries = data?.equitySeries || [];
  const weeklyPnL = data?.weeklyPnL || [];
  const brokerPnL = data?.brokerPnL || [];
  const dailyActivity = data?.dailyActivity || [];

  const displayedActivity = weekdaysOnly
    ? dailyActivity.filter((d) => !d.isWeekend)
    : dailyActivity;

  const avgWin = Number(data?.averageWin || 0);
  const avgLoss = Number(data?.averageLoss || 0);

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Performance analytics</h1>
          <p className="page-description">Understand patterns behind your trading results.</p>
        </div>
      </div>

      {/* FILTER BAR (PERIOD + BROKER) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Calendar size={13} /> Period:
          </span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                id={`analytics-range-${r.id}`}
                className={`btn btn-sm ${range === r.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 12, padding: '4px 11px' }}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Building2 size={13} /> Broker:
          </span>
          {brokerOptions.map((opt) => {
            const meta = BROKER_META[opt.id];
            const isActive = brokerFilter === opt.id;
            return (
              <button
                key={opt.id}
                id={`analytics-broker-${opt.id}`}
                onClick={() => setBrokerFilter(opt.id)}
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: `1.5px solid ${isActive ? (meta?.color || 'var(--accent)') : 'var(--border)'}`,
                  background: isActive ? `${meta?.color || 'var(--accent)'}22` : 'var(--bg-tertiary)',
                  color: isActive ? (meta?.color || 'var(--accent)') : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5
                }}
              >
                {meta && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />}
                {opt.label}
              </button>
            );
          })}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)' }}>
            {data?.totalTrades ?? (data?.closedTrades || 0)} trades
          </span>
        </div>
      </div>

      {showBanner && (
        <div className="info-banner" style={{ position: 'relative' }}>
          <Info size={15} />
          <span>Analytics are calculated from your saved TradeGuard trade records.</span>
          <button className="icon-btn" style={{ marginLeft: 'auto', width: 24, height: 24 }} onClick={() => setShowBanner(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="info-banner" role="alert">
          Could not load analytics: {error}
        </div>
      )}

      {loading ? (
        <p>Loading analytics…</p>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Average win"
              value={avgWin > 0 ? `₹${Math.round(avgWin).toLocaleString('en-IN')}` : '—'}
              change={brokerFilter !== 'all' ? (BROKER_META[brokerFilter]?.name || brokerFilter) : 'Across brokers'}
              changeType="positive"
            />
            <StatCard
              label="Average loss"
              value={avgLoss ? `₹${Math.round(avgLoss).toLocaleString('en-IN')}` : '—'}
              change="Per FIFO-matched losing close"
              changeType="neutral"
            />
            <StatCard
              label="Closed trades"
              value={data?.closedTrades ?? 0}
              change={`${data?.winningTrades || 0} wins · ${data?.losingTrades || 0} losses`}
              changeType="neutral"
            />
            <StatCard
              label="Net realized P&L"
              value={`₹${Math.round(data?.realizedPnL || 0).toLocaleString('en-IN')}`}
              change={brokerFilter !== 'all' ? `${BROKER_META[brokerFilter]?.name || brokerFilter} closes` : 'FIFO matched closes'}
              changeType={(data?.realizedPnL || 0) >= 0 ? 'positive' : 'negative'}
            />
            <StatCard
              label="Broker performance"
              value={
                brokerFilter !== 'all'
                  ? (BROKER_META[brokerFilter]?.name || brokerFilter)
                  : (brokerPnL.length > 0 ? brokerPnL.reduce((a, b) => (a.value > b.value ? a : b)).name : '—')
              }
              change={
                brokerFilter !== 'all'
                  ? `₹${Math.round(data?.realizedPnL || 0).toLocaleString('en-IN')}`
                  : (brokerPnL.length > 0 ? `₹${Math.round(brokerPnL.reduce((a, b) => (a.value > b.value ? a : b)).value).toLocaleString('en-IN')}` : '')
              }
              changeType={
                brokerFilter !== 'all'
                  ? ((data?.realizedPnL || 0) >= 0 ? 'positive' : 'negative')
                  : 'positive'
              }
            />
            <StatCard
              label="Most active day"
              value={dailyActivity.length > 0 ? dailyActivity.reduce((a, b) => (a.value > b.value ? a : b)).day : '—'}
              change={dailyActivity.length > 0 ? `${dailyActivity.reduce((a, b) => (a.value > b.value ? a : b)).value} trades` : ''}
              changeType="neutral"
            />
          </div>

          <div className="grid-2" style={{ marginBottom: 20 }}>
            <Card title="P&L over time" subtitle="Cumulative realized P&L by execution trade date">
              {equitySeries.length > 0 ? (
                <LineChart data={equitySeries} height={280} />
              ) : (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No equity history available yet.
                </div>
              )}
            </Card>

            <Card title="Win and loss distribution" subtitle="Gross weekly outcomes">
              {weeklyPnL.length > 0 ? (
                <GroupedBarChart
                  data={weeklyPnL}
                  series={[
                    { key: 'wins', label: 'Gross wins', color: '#10b981' },
                    { key: 'losses', label: 'Gross losses', color: '#ef4444' },
                  ]}
                />
              ) : (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No weekly data available.
                </div>
              )}
            </Card>
          </div>

          <div className="grid-2">
            <Card
              title="Performance by broker"
              subtitle={brokerFilter !== 'all' ? `${BROKER_META[brokerFilter]?.name || brokerFilter} Net P&L contribution` : 'Net P&L contribution'}
            >
              {brokerPnL.length > 0 ? (
                <SimpleBarChart
                  data={brokerPnL.map((b) => ({
                    label: b.name,
                    value: b.value,
                    trades: b.trades,
                    dateRange: `${b.name} (${b.trades || 0} executed trades)`
                  }))}
                  color="#3b82f6"
                  valueFormatter={(v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                />
              ) : (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No broker performance data.
                </div>
              )}
            </Card>

            <Card
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span>{range === 'all' || range === '1y' || range === '90d' ? 'Trading activity by day of week' : 'Trading activity by day'}</span>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={weekdaysOnly}
                      onChange={(e) => setWeekdaysOnly(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    Weekdays only (Mon–Fri)
                  </label>
                </div>
              }
              subtitle={range === 'all' || range === '1y' || range === '90d' ? 'Executed trade count across trading sessions' : 'Executed trade count'}
            >
              {displayedActivity.length > 0 ? (
                <>
                  <SimpleBarChart
                    data={displayedActivity}
                    color="#d97706"
                    valueFormatter={(v) => `${v} trades`}
                  />
                  {!weekdaysOnly && dailyActivity.some((d) => d.label === 'Sun' && d.value > 0) && (
                    <div style={{
                      marginTop: 14,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: 'rgba(217, 119, 6, 0.08)',
                      border: '1px solid rgba(217, 119, 6, 0.25)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4
                    }}>
                      💡 <strong>Sunday Trading Session (1 Feb 2026):</strong> Indian stock exchanges (NSE &amp; BSE) conducted a special live trading session on <strong>Sunday, February 1, 2026</strong> for the Union Budget. These 8 executions were imported from Upstox. You can inspect or delete them anytime on the <a href="/app/trades" style={{ color: '#60a5fa', textDecoration: 'underline' }}>Trades</a> page or toggle &quot;Weekdays only&quot; above.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No activity data.
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
