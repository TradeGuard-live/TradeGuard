import React, { useEffect, useState } from 'react';
import { Card, StatCard } from '../components/Card';
import LineChart from '../components/charts/LineChart';
import { GroupedBarChart, SimpleBarChart } from '../components/charts/BarChart';
import { Info, X } from 'lucide-react';
import { api } from '../api/client';

export default function Analytics() {
  const [range, setRange] = useState('all');
  const [showBanner, setShowBanner] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      setLoading(true);
      setError('');
      try {
        const response = await api.tradeAnalytics(range);
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
  }, [range]);

  const equitySeries = data?.equitySeries || [];
  const weeklyPnL = data?.weeklyPnL || [];
  const brokerPnL = data?.brokerPnL || [];
  const dailyActivity = data?.dailyActivity || [];

  const avgWin = Number(data?.averageWin || 0);
  const avgLoss = Number(data?.averageLoss || 0);

  return (
    <>
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Performance analytics</h1>
          <p className="page-description">Understand patterns behind your trading results.</p>
        </div>
        <select className="filter-select" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last 1 year</option>
          <option value="all">All time</option>
        </select>
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
            <StatCard label="Average win" value={avgWin > 0 ? `₹${Math.round(avgWin).toLocaleString('en-IN')}` : '—'} change="Across brokers" changeType="positive" />
            <StatCard label="Average loss" value={avgLoss ? `₹${Math.round(avgLoss).toLocaleString('en-IN')}` : '—'} change="Per FIFO-matched losing close" changeType="neutral" />
            <StatCard label="Closed trades" value={data?.closedTrades ?? 0} change={`${data?.winningTrades || 0} wins · ${data?.losingTrades || 0} losses`} changeType="neutral" /> 
            <StatCard label="Net realized P&L" value={`₹${Math.round(data?.realizedPnL || 0).toLocaleString('en-IN')}`} change="FIFO matched closes" changeType={(data?.realizedPnL || 0)>=0?"positive":"negative"} /> 
            <StatCard label="Broker performance" value={brokerPnL.length > 0 ? brokerPnL.reduce((a, b) => a.value > b.value ? a : b).name : '—'} change={brokerPnL.length > 0 ? `₹${Math.round(brokerPnL.reduce((a, b) => a.value > b.value ? a : b).value).toLocaleString('en-IN')}` : ''} changeType="positive" />
            <StatCard label="Most active day" value={dailyActivity.length > 0 ? dailyActivity.reduce((a, b) => a.value > b.value ? a : b).day : '—'} change={dailyActivity.length > 0 ? `${dailyActivity.reduce((a, b) => a.value > b.value ? a : b).value} trades` : ''} changeType="neutral" />
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
            <Card title="Performance by broker" subtitle="Net P&L contribution">
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
              title={range === 'all' || range === '1y' || range === '90d' ? 'Trading activity by day of week' : 'Trading activity by day'}
              subtitle={range === 'all' || range === '1y' || range === '90d' ? 'Executed trade count across days (Mon – Sun)' : 'Executed trade count'}
            >
              {dailyActivity.length > 0 ? (
                <SimpleBarChart
                  data={dailyActivity}
                  color="#d97706"
                  valueFormatter={(v) => `${v} trades`}
                />
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
