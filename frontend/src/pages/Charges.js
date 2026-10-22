import React, { useEffect, useState, useMemo } from 'react';
import { Card, InfoBanner } from '../components/Card';
import { Receipt, Calculator, Search, Calendar, RefreshCw, Building2 } from 'lucide-react';
import { api } from '../api/client';
import { BROKER_META } from '../data/mockData';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 Days' },
  { id: '30d',   label: '1 Month' },
  { id: '1y',    label: '1 Year' },
  { id: 'all',   label: 'All Time' }
];

const FEE_ITEMS = [
  { key: 'brokerage',       label: 'Brokerage',        desc: 'Broker execution commission',              color: '#6366f1' },
  { key: 'stt',             label: 'STT / CTT',         desc: 'Securities / Commodities transaction tax', color: '#ec4899' },
  { key: 'gst',             label: 'GST (18%)',          desc: 'Govt tax on brokerage & exchange fees',   color: '#f59e0b' },
  { key: 'exchangeCharges', label: 'Exchange Turnover',  desc: 'NSE/BSE exchange charges',                color: '#10b981' },
  { key: 'stampDuty',       label: 'Stamp Duty',         desc: 'State stamp duty on buy turnover',        color: '#06b6d4' },
  { key: 'sebiCharges',     label: 'SEBI Turnover',      desc: '₹10/crore regulatory fee',               color: '#8b5cf6' },
  { key: 'dpCharges',       label: 'DP Charges',         desc: 'Depository fee on delivery sells',        color: '#64748b' },
  { key: 'ctt',             label: 'Commodity Tax',      desc: 'CTT on commodity segments',               color: '#14b8a6' }
];

export default function Charges() {
  const [activeTab, setActiveTab]       = useState('analytics');
  const [range, setRange]               = useState('30d');
  const [brokerFilter, setBrokerFilter] = useState('all');
  const [analytics, setAnalytics]       = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [search, setSearch]             = useState('');

  // Simulator
  const [broker, setBroker]           = useState('UPSTOX');
  const [productType, setProductType] = useState('Equity intraday');
  const [buyPrice, setBuyPrice]       = useState(125);
  const [sellPrice, setSellPrice]     = useState(132.5);
  const [quantity, setQuantity]       = useState(50);
  const [simResult, setSimResult]     = useState(null);
  const [simLoading, setSimLoading]   = useState(false);
  const [simError, setSimError]       = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const res = await api.chargesAnalytics(range, brokerFilter);
        if (active) setAnalytics(res?.data || null);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load charges analytics');
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [range, brokerFilter]);

  useEffect(() => {
    if (activeTab !== 'simulator') return;
    let active = true;
    async function calc() {
      setSimLoading(true); setSimError('');
      try {
        const res = await api.calculateCharges({ broker, productType, buyPrice: Number(buyPrice), sellPrice: Number(sellPrice), quantity: Number(quantity) });
        if (active) setSimResult(res?.data || null);
      } catch (err) { if (active) setSimError(err.message || 'Failed to calculate'); }
      finally { if (active) setSimLoading(false); }
    }
    const t = setTimeout(calc, 300);
    return () => { active = false; clearTimeout(t); };
  }, [broker, productType, buyPrice, sellPrice, quantity, activeTab]);

  const fmt = (n) => '₹' + Number(Math.abs(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filteredTrades = useMemo(() => {
    if (!analytics?.recentTrades) return [];
    if (!search.trim()) return analytics.recentTrades;
    const q = search.toLowerCase();
    return analytics.recentTrades.filter(t => t.symbol?.toLowerCase().includes(q) || t.tradeId?.toLowerCase().includes(q) || t.orderId?.toLowerCase().includes(q));
  }, [analytics?.recentTrades, search]);

  const brokerOptions = useMemo(() => {
    const from = analytics?.availableBrokers || [];
    const all  = from.length > 0 ? from : Object.keys(BROKER_META);
    return [{ id: 'all', label: 'All Brokers (Combined)' }, ...all.map(b => ({ id: b, label: BROKER_META[b]?.name || b }))];
  }, [analytics?.availableBrokers]);

  const activeMeta = brokerFilter !== 'all' ? BROKER_META[brokerFilter] : null;

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Charges &amp; Taxes Analytics</h1>
          <p className="page-description">Exact statutory and broker fees aggregated directly from your executed trades.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-tertiary)', padding: 4, borderRadius: 8 }}>
          <button id="charges-tab-analytics" className={`btn btn-sm ${activeTab === 'analytics' ? 'btn-primary' : 'btn-secondary'}`} style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setActiveTab('analytics')}>
            <Receipt size={14} /> Real Trade Charges
          </button>
          <button id="charges-tab-simulator" className={`btn btn-sm ${activeTab === 'simulator' ? 'btn-primary' : 'btn-secondary'}`} style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setActiveTab('simulator')}>
            <Calculator size={14} /> Hypothetical Simulator
          </button>
        </div>
      </div>

      {activeTab === 'analytics' ? (
        <>
          {/* FILTER BAR */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={13} /> Period:</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {RANGES.map(r => (
                  <button key={r.id} id={`charges-range-${r.id}`} className={`btn btn-sm ${range === r.id ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12, padding: '4px 11px' }} onClick={() => setRange(r.id)}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}><Building2 size={13} /> Broker:</span>
              {brokerOptions.map(opt => {
                const meta = BROKER_META[opt.id];
                const isActive = brokerFilter === opt.id;
                return (
                  <button key={opt.id} id={`charges-broker-${opt.id}`} onClick={() => setBrokerFilter(opt.id)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: `1.5px solid ${isActive ? (meta?.color || 'var(--accent)') : 'var(--border)'}`, background: isActive ? `${meta?.color || 'var(--accent)'}22` : 'var(--bg-tertiary)', color: isActive ? (meta?.color || 'var(--accent)') : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400, transition: 'all 0.15s ease', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {meta && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />}
                    {opt.label}
                  </button>
                );
              })}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)' }}>{analytics?.totalTrades || 0} trades</span>
            </div>
          </div>

          {error && <div className="info-banner" role="alert" style={{ marginBottom: 16 }}>Could not load charges analytics: {error}</div>}

          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} className="spinner" style={{ margin: '0 auto 12px' }} />
              <div>Calculating statutory &amp; broker fees…</div>
            </div>
          ) : !analytics || analytics.totalTrades === 0 ? (
            <Card>
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <Receipt size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No executed trades in this period</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 460, margin: '0 auto 16px' }}>
                  {brokerFilter !== 'all' ? `No trades for ${BROKER_META[brokerFilter]?.name || brokerFilter} in this period.` : `No completed trades for ${RANGES.find(r => r.id === range)?.label || range}.`} Try a different broker or timeframe.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => setBrokerFilter('all')}>All Brokers</button>
                  <button className="btn btn-secondary" onClick={() => setRange('all')}>All Time</button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* KPI CARDS */}
              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <div className="stat-card" style={{ borderLeft: '3px solid #f59e0b' }}>
                  <div className="stat-label">Total Charges Incurred</div>
                  <div className="stat-value" style={{ color: '#fbbf24' }}>{fmt(analytics.totalCharges)}</div>
                  <div className="stat-change neutral" style={{ fontSize: 11 }}>{analytics.chargesToTurnoverPercent}% of turnover · Avg {fmt(analytics.avgChargePerTrade)}/trade</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '3px solid #6366f1' }}>
                  <div className="stat-label">Total Traded Turnover</div>
                  <div className="stat-value mono">{fmt(analytics.totalTurnover)}</div>
                  <div className="stat-change neutral" style={{ fontSize: 11 }}>Across {analytics.totalTrades} executions</div>
                </div>
                <div className="stat-card" style={{ borderLeft: `3px solid ${analytics.grossPnL >= 0 ? '#10b981' : '#f43f5e'}` }}>
                  <div className="stat-label">Gross Realized P&amp;L</div>
                  <div className="stat-value mono" style={{ color: analytics.grossPnL >= 0 ? 'var(--success)' : 'var(--danger)' }}>{analytics.grossPnL >= 0 ? '+' : '-'}{fmt(analytics.grossPnL)}</div>
                  <div className="stat-change neutral" style={{ fontSize: 11 }}>Before statutory deductions</div>
                </div>
                <div className="stat-card" style={{ borderLeft: `3px solid ${analytics.netPnL >= 0 ? '#10b981' : '#f43f5e'}` }}>
                  <div className="stat-label">Net Realized P&amp;L</div>
                  <div className="stat-value mono" style={{ color: analytics.netPnL >= 0 ? 'var(--success)' : 'var(--danger)' }}>{analytics.netPnL >= 0 ? '+' : '-'}{fmt(analytics.netPnL)}</div>
                  <div className="stat-change" style={{ fontSize: 11, color: '#f87171' }}>Fee drag: -{fmt(analytics.totalCharges)}</div>
                </div>
              </div>

              {/* FEE COMPOSITION */}
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Fee Composition Breakdown</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total: {fmt(analytics.totalCharges)}</div>
                </div>
                <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', marginBottom: 14 }}>
                  {FEE_ITEMS.map(item => { const pct = analytics.percentages?.[item.key] || 0; if (pct <= 0) return null; return <div key={item.key} style={{ width: `${pct}%`, backgroundColor: item.color, transition: 'width 0.4s ease' }} title={`${item.label}: ${pct}%`} />; })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                  {FEE_ITEMS.map(item => {
                    const amount = analytics.breakdown?.[item.key] || 0;
                    const pct    = analytics.percentages?.[item.key] || 0;
                    return (
                      <div key={item.key} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: item.color }} />{item.label}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(amount)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* BROKER-WISE BREAKDOWN */}
              {analytics.brokerBreakdown && analytics.brokerBreakdown.length > 0 && (
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Building2 size={14} color="var(--accent)" /> Broker-Wise Charge Summary
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {analytics.brokerBreakdown.length > 1 ? 'Click a card to drill into a single broker' : 'Single broker view'}
                      </div>
                    </div>
                    {brokerFilter !== 'all' && (
                      <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} onClick={() => setBrokerFilter('all')}>← All Brokers</button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
                    {analytics.brokerBreakdown.map(b => {
                      const meta     = BROKER_META[b.broker];
                      const isActive = brokerFilter === b.broker;
                      const barPct   = analytics.totalCharges > 0 ? (b.charges / analytics.totalCharges) * 100 : 0;
                      return (
                        <div key={b.broker} id={`broker-card-${b.broker}`} onClick={() => setBrokerFilter(isActive ? 'all' : b.broker)} style={{ background: isActive ? `${meta?.color || '#6366f1'}18` : 'var(--bg-tertiary)', border: `1.5px solid ${isActive ? (meta?.color || '#6366f1') : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s ease' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${meta?.color || '#6366f1'}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: meta?.color || '#6366f1' }}>
                                {meta?.short || b.broker[0]}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{meta?.name || b.broker}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{b.trades} trade{b.trades !== 1 ? 's' : ''}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: '#fbbf24' }}>{fmt(b.charges)}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{b.percentage}% of total</div>
                            </div>
                          </div>
                          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${barPct}%`, background: meta?.color || '#6366f1', transition: 'width 0.4s ease' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Turnover</span>
                            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmt(b.turnover)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TOP SYMBOLS + TIMELINE */}
              <div className="grid-2" style={{ marginBottom: 20 }}>
                <Card title="Top Instruments by Charges" subtitle="Symbols incurring the highest fees">
                  {analytics.topSymbols?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {analytics.topSymbols.map((item, idx) => (
                        <div key={item.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{idx + 1}</span>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{item.symbol}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24' }}>{fmt(item.charges)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.percentage}% of total fees</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No symbol breakdown available</div>}
                </Card>

                <Card title="Charges Timeline" subtitle="Historical distribution across trading sessions">
                  {analytics.timeline?.length > 0 ? (
                    <div style={{ maxHeight: 250, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {analytics.timeline.slice(-8).reverse().map(t => (
                        <div key={t.date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={14} color="var(--text-muted)" />
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{t.date}</span>
                          </div>
                          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24' }}>{fmt(t.charges)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Timeline data will populate as trades occur</div>}
                </Card>
              </div>

              {/* TRADES TABLE */}
              <Card title="Executed Trades & Itemized Charges" subtitle={`Per-execution breakdown${brokerFilter !== 'all' ? ` · ${BROKER_META[brokerFilter]?.name || brokerFilter}` : ' · All Brokers'}`}>
                <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="search-box" style={{ maxWidth: 280, width: '100%' }}>
                    <Search size={14} />
                    <input id="charges-search" placeholder="Filter by symbol or ID..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  {brokerFilter !== 'all' && activeMeta && (
                    <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: `${activeMeta.color}22`, color: activeMeta.color, border: `1px solid ${activeMeta.color}44`, fontWeight: 500 }}>{activeMeta.name}</span>
                  )}
                </div>
                <div className="table-wrapper" style={{ maxHeight: 400, overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Symbol</th>
                        <th>Broker</th>
                        <th>Side</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Exec Price</th>
                        <th className="text-right">Turnover</th>
                        <th className="text-right">Brokerage</th>
                        <th className="text-right">STT</th>
                        <th className="text-right">Exchange</th>
                        <th className="text-right">GST</th>
                        <th className="text-right">Total Charges</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTrades.length === 0 ? (
                        <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No trades match your filter</td></tr>
                      ) : filteredTrades.map(t => {
                        const isBuy = t.transactionType === 'BUY';
                        const tMeta = BROKER_META[t.broker];
                        return (
                          <tr key={t._id || t.tradeId}>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.tradeTime ? new Date(t.tradeTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.symbol}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.segment || 'EQUITY'}</div>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: `${tMeta?.color || '#6366f1'}22`, color: tMeta?.color || '#6366f1' }}>
                                {tMeta?.short || t.broker || 'N/A'}
                              </span>
                            </td>
                            <td><span className={`badge ${isBuy ? 'badge-success' : 'badge-danger'}`}>{t.transactionType}</span></td>
                            <td className="text-right mono">{t.quantity}</td>
                            <td className="text-right mono">{fmt(t.price)}</td>
                            <td className="text-right mono">{fmt(t.turnover)}</td>
                            <td className="text-right mono">{fmt(t.charges?.brokerage)}</td>
                            <td className="text-right mono">{fmt(t.charges?.stt)}</td>
                            <td className="text-right mono">{fmt(t.charges?.exchangeCharges)}</td>
                            <td className="text-right mono">{fmt(t.charges?.gst)}</td>
                            <td className="text-right mono" style={{ fontWeight: 700, color: '#fbbf24' }}>{fmt(t.charges?.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      ) : (
        <>
          <InfoBanner icon={Calculator}>
            Hypothetical Simulator: test order scenarios to estimate statutory and broker fees before entering a position.
          </InfoBanner>
          {simError && <div className="info-banner" role="alert" style={{ marginBottom: 16 }}>Could not calculate: {simError}</div>}
          <div className="grid-2">
            <Card title="Hypothetical Trade Inputs" subtitle="Enter simulated order values">
              <div className="form-group">
                <label className="form-label">Broker</label>
                <select id="sim-broker" className="form-select" value={broker} onChange={e => setBroker(e.target.value)}>
                  {Object.entries(BROKER_META).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Product type</label>
                <select id="sim-product" className="form-select" value={productType} onChange={e => setProductType(e.target.value)}>
                  <option>Equity intraday</option>
                  <option>Equity delivery</option>
                  <option>Futures</option>
                  <option>Options</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Buy price (₹)</label>
                  <input id="sim-buy-price" type="number" step="any" className="form-input" value={buyPrice} onChange={e => setBuyPrice(Number(e.target.value))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Sell price (₹)</label>
                  <input id="sim-sell-price" type="number" step="any" className="form-input" value={sellPrice} onChange={e => setSellPrice(Number(e.target.value))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input id="sim-quantity" type="number" className="form-input" value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
              </div>
            </Card>
            <Card title="Estimated Breakdown (8 Fees)" subtitle="Calculated with statutory SEBI/Exchange rules">
              {simLoading && !simResult ? <p>Calculating charges…</p> : simResult ? (
                <>
                  {[
                    { label: 'Brokerage',                       val: simResult.brokerage },
                    { label: 'STT (Securities Transaction Tax)', val: simResult.stt },
                    { label: 'Exchange Transaction Charges',      val: simResult.exchangeCharges },
                    { label: 'SEBI Turnover Charges',            val: simResult.sebiCharges },
                    { label: 'Stamp Duty',                       val: simResult.stampDuty },
                    { label: 'DP Charges',                       val: simResult.dpCharges },
                    { label: 'GST (18%)',                        val: simResult.gst }
                  ].map(({ label, val }) => (
                    <div key={label} className="detail-row">
                      <span className="detail-label">{label}</span>
                      <span className="detail-value mono">{fmt(val)}</span>
                    </div>
                  ))}
                  <div className="detail-row" style={{ borderTop: '2px solid var(--border)', marginTop: 8, paddingTop: 14 }}>
                    <span className="detail-label" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Total Combined Charges</span>
                    <span className="detail-value mono" style={{ color: '#fbbf24', fontWeight: 700, fontSize: 16 }}>{fmt(simResult.totalCharges)}</span>
                  </div>
                  <div className="grid-2" style={{ marginTop: 20 }}>
                    {[{ label: 'Simulated Gross P&L', val: simResult.grossPnL }, { label: 'Simulated Net P&L', val: simResult.netPnL }].map(({ label, val }) => (
                      <div key={label} style={{ background: 'var(--bg-tertiary)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: val >= 0 ? 'var(--success)' : 'var(--danger)' }}>{val >= 0 ? '+' : '-'}{fmt(val)}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p>Enter trade values to see the charges breakdown.</p>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
