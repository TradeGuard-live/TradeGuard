import React, { useEffect, useState, useCallback } from 'react';
import { Card, StatCard, InfoBanner } from '../components/Card';
import { Info, Download, Printer, RefreshCw, TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { BROKER_META } from '../data/mockData';

export default function Reports() {
  const [range, setRange] = useState('all');
  const [brokerFilter, setBrokerFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('positions'); // 'positions' | 'trades'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.tradeReports(range, brokerFilter);
      setData(response?.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [range, brokerFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const formatINR = (n) => {
    const val = Number(n) || 0;
    return '₹' + Math.abs(val).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  // --------------------------------------------------
  // GENUINE CSV EXPORT GENERATOR
  // --------------------------------------------------
  function handleExportCSV() {
    if (!data) {
      toast.push('No report data available to export', 'warning');
      return;
    }

    try {
      const rows = [];
      rows.push(['TradeGuard Performance Report']);
      rows.push(['Report Period', range.toUpperCase()]);
      rows.push(['Generated At', new Date().toLocaleString()]);
      rows.push(['Broker Filter', brokerFilter.toUpperCase()]);
      rows.push([]);

      // Section 1: Executive Summary
      rows.push(['EXECUTIVE SUMMARY']);
      rows.push(['Metric', 'Value']);
      rows.push(['Net P&L', data.netPnl]);
      rows.push(['Gross P&L', data.grossPnl ?? data.netPnl]);
      rows.push(['Total Charges & Taxes', data.totalCharges ?? 0]);
      rows.push(['Total Executions', data.totalTrades ?? 0]);
      rows.push(['Closed Positions', data.closedTrades ?? 0]);
      rows.push(['Win Rate (%)', `${data.winRate}%`]);
      rows.push(['Winning Positions', data.winningTrades ?? 0]);
      rows.push(['Losing Positions', data.losingTrades ?? 0]);
      rows.push(['Profit Factor', data.profitFactor ?? 1]);
      rows.push(['Average Win', data.averageWin ?? 0]);
      rows.push(['Average Loss', data.averageLoss ?? 0]);
      rows.push(['Largest Win', data.largestWin ?? 0]);
      rows.push(['Largest Loss', data.largestLoss ?? 0]);
      rows.push([]);

      // Section 2: Broker Breakdown
      if (Array.isArray(data.brokerBreakdown) && data.brokerBreakdown.length > 0) {
        rows.push(['BROKER BREAKDOWN']);
        rows.push(['Broker Key', 'Broker Name', 'Realized P&L (₹)']);
        data.brokerBreakdown.forEach((b) => {
          rows.push([b.broker, b.name, b.value]);
        });
        rows.push([]);
      }

      // Section 3: Closed Positions (Realized Trades)
      if (Array.isArray(data.closedPositions) && data.closedPositions.length > 0) {
        rows.push(['CLOSED POSITIONS (REALIZED P&L)']);
        rows.push(['Symbol', 'Broker', 'Quantity', 'Entry Price', 'Exit Price', 'Realized P&L (₹)', 'Return (%)', 'Date']);
        data.closedPositions.forEach((pos) => {
          rows.push([
            pos.symbol,
            pos.brokerName || pos.broker,
            pos.quantity,
            pos.entryPrice,
            pos.exitPrice,
            pos.pnl,
            pos.pnlPercent ? `${pos.pnlPercent}%` : '0%',
            new Date(pos.date).toLocaleDateString('en-IN')
          ]);
        });
        rows.push([]);
      }

      // Section 4: Executed Trades Log
      if (Array.isArray(data.trades) && data.trades.length > 0) {
        rows.push(['ALL EXECUTIONS LOG']);
        rows.push(['Trade ID', 'Order ID', 'Symbol', 'Broker', 'Segment', 'Product', 'Side', 'Quantity', 'Executed Price', 'Timestamp']);
        data.trades.forEach((t) => {
          rows.push([
            t.tradeId || '',
            t.orderId || '',
            t.symbol || '',
            t.brokerName || t.broker || '',
            t.segment || '',
            t.productCode || '',
            t.transactionType || '',
            t.quantity || 0,
            t.executedPrice || 0,
            t.tradeTime ? new Date(t.tradeTime).toLocaleString('en-IN') : ''
          ]);
        });
      }

      const csvContent = rows
        .map((row) =>
          row
            .map((cell) => {
              const str = String(cell ?? '');
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(',')
        )
        .join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `TradeGuard-Report-${range}-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.push('Performance report CSV exported successfully!', 'success');
    } catch (exportErr) {
      console.error('CSV Export Error:', exportErr);
      toast.push('Failed to generate CSV export', 'error');
    }
  }

  // --------------------------------------------------
  // GENUINE PRINT / PDF TRIGGER
  // --------------------------------------------------
  function handlePrintPDF() {
    window.print();
  }

  return (
    <>
      {/* Header specifically shown only during print / PDF export */}
      <div className="report-print-header">
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#111827' }}>TradeGuard Performance Report</h1>
        <p style={{ margin: '4px 0 0 0', color: '#4b5563', fontSize: 13 }}>
          Period: <strong>{range.toUpperCase()}</strong> | Broker: <strong>{brokerFilter.toUpperCase()}</strong> | Generated: {new Date().toLocaleString('en-IN')}
        </p>
      </div>

      <div className="page-header page-header-row report-hide-print">
        <div>
          <h1 className="page-title">Performance Report</h1>
          <p className="page-description">
            Complete trading statement, realized P&amp;L analytics, and tax-ready breakdown.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            className="filter-select"
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
          >
            <option value="all">All Brokers</option>
            {Object.entries(BROKER_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.name}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last 1 year</option>
            <option value="fy">Financial Year (FY)</option>
            <option value="all">All Time</option>
          </select>

          <button className="btn btn-secondary" onClick={loadReport} title="Refresh report">
            <RefreshCw size={14} className={loading ? 'spinner' : ''} />
          </button>

          <button className="btn btn-secondary" onClick={handleExportCSV} title="Download CSV">
            <Download size={14} /> CSV
          </button>

          <button className="btn btn-primary" onClick={handlePrintPDF} title="Print or Save as PDF">
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="report-hide-print">
        <InfoBanner icon={Info}>
          Report data includes FIFO-matched realized P&amp;L and statutory charges calculated from saved trade records.
        </InfoBanner>
      </div>

      {error && (
        <div className="info-banner" role="alert" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          Could not load report: {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ display: 'inline-block', marginBottom: 12 }} />
          <p>Calculating report metrics from trade records…</p>
        </div>
      ) : data ? (
        <>
          {/* Key Stat Cards */}
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <StatCard
              label="Net P&L"
              value={data.netPnl >= 0 ? `+${formatINR(data.netPnl)}` : `-${formatINR(data.netPnl)}`}
              change={`Gross: ${data.grossPnl >= 0 ? '+' : '-'}${formatINR(data.grossPnl)}`}
              changeType={data.netPnl >= 0 ? 'positive' : 'negative'}
            />
            <StatCard
              label="Statutory Charges &amp; Taxes"
              value={formatINR(data.totalCharges || 0)}
              change={`${data.totalTrades || 0} executions in period`}
              changeType="neutral"
            />
            <StatCard
              label="Win Rate"
              value={`${data.winRate}%`}
              change={`${data.winningTrades || 0} won / ${data.losingTrades || 0} lost`}
              changeType={data.winRate >= 50 ? 'positive' : data.winRate > 0 ? 'neutral' : 'negative'}
            />
            <StatCard
              label="Profit Factor"
              value={data.profitFactor ? String(data.profitFactor) : '1.0'}
              change={`Avg win ${formatINR(data.averageWin)}`}
              changeType={data.profitFactor >= 1.5 ? 'positive' : 'neutral'}
            />
          </div>

          {/* Breakdown Grids */}
          <div className="grid-2" style={{ marginBottom: 24 }}>
            <Card title="Trade Statistics &amp; Risk Metrics">
              {[
                ['Closed Positions', String(data.closedTrades || 0)],
                ['Total Executions', String(data.totalTrades || 0)],
                ['Winning Trades', `${data.winningTrades || 0} (${data.winRate}%)`],
                ['Losing Trades', String(data.losingTrades || 0)],
                ['Average Win', formatINR(data.averageWin || 0)],
                ['Average Loss', formatINR(data.averageLoss || 0)],
                ['Largest Winning Trade', `+${formatINR(data.largestWin || 0)}`],
                ['Largest Losing Trade', `-${formatINR(data.largestLoss || 0)}`],
              ].map(([label, value], i) => (
                <div
                  className="detail-row"
                  key={label}
                  style={i === 0 ? { paddingTop: 0 } : undefined}
                >
                  <span className="detail-label">{label}</span>
                  <span className="detail-value mono">{value}</span>
                </div>
              ))}
            </Card>

            <Card title="Broker-wise Contribution" subtitle="Net P&L distribution by broker">
              {!data.brokerBreakdown || data.brokerBreakdown.length === 0 ? (
                <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No broker execution data in this period.
                </div>
              ) : (
                data.brokerBreakdown.map((b) => (
                  <div className="detail-row" key={b.broker}>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contribution to Net P&amp;L</div>
                    </div>
                    <span
                      className="detail-value mono"
                      style={{
                        fontWeight: 700,
                        color: b.value >= 0 ? 'var(--success)' : 'var(--danger)'
                      }}
                    >
                      {b.value >= 0 ? '+' : '-'}{formatINR(b.value)}
                    </span>
                  </div>
                ))
              )}
            </Card>
          </div>

          {/* Detailed Statement Table */}
          <Card
            title={activeTab === 'positions' ? 'Closed Positions Statement' : 'Trade Executions Log'}
            subtitle={`Showing ${activeTab === 'positions' ? (data.closedPositions?.length || 0) : (data.trades?.length || 0)} entries in selected period`}
            action={
              <div className="flex gap-2 report-hide-print">
                <button
                  className={`btn btn-sm ${activeTab === 'positions' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActiveTab('positions')}
                >
                  Closed Positions ({data.closedPositions?.length || 0})
                </button>
                <button
                  className={`btn btn-sm ${activeTab === 'trades' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActiveTab('trades')}
                >
                  All Executions ({data.trades?.length || 0})
                </button>
              </div>
            }
          >
            {activeTab === 'positions' ? (
              !data.closedPositions || data.closedPositions.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No closed positions found for this period. Try selecting "Financial Year" or "All Time".
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}>
                        <th style={{ padding: '10px 12px' }}>Symbol</th>
                        <th style={{ padding: '10px 12px' }}>Broker</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Entry Price</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Exit Price</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Realized P&amp;L</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Return</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Close Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.closedPositions.map((pos, idx) => {
                        const isWin = pos.pnl >= 0;
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{pos.symbol}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span className="badge" style={{ fontSize: 11 }}>{pos.brokerName || pos.broker}</span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{pos.quantity}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>₹{pos.entryPrice}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>₹{pos.exitPrice}</td>
                            <td style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              color: isWin ? 'var(--success)' : 'var(--danger)'
                            }}>
                              {isWin ? '+' : ''}{formatINR(pos.pnl)}
                            </td>
                            <td style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              color: isWin ? 'var(--success)' : 'var(--danger)'
                            }}>
                              {isWin ? '+' : ''}{pos.pnlPercent}%
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                              {new Date(pos.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              !data.trades || data.trades.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No trade executions found for this period.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}>
                        <th style={{ padding: '10px 12px' }}>Date &amp; Time</th>
                        <th style={{ padding: '10px 12px' }}>Symbol</th>
                        <th style={{ padding: '10px 12px' }}>Side</th>
                        <th style={{ padding: '10px 12px' }}>Broker</th>
                        <th style={{ padding: '10px 12px' }}>Type</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Exec Price</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Trade ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trades.map((t, idx) => {
                        const isBuy = t.transactionType === 'BUY';
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                              {new Date(t.tradeTime).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{t.symbol}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                background: isBuy ? 'var(--success-bg)' : 'var(--danger-bg)',
                                color: isBuy ? 'var(--success)' : 'var(--danger)'
                              }}>
                                {t.transactionType}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span className="badge" style={{ fontSize: 11 }}>{t.brokerName || t.broker}</span>
                            </td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                              {t.segment} / {t.productCode}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{t.quantity}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                              ₹{t.executedPrice}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                              {t.tradeId}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </Card>
        </>
      ) : (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          No report data available.
        </div>
      )}
    </>
  );
}
