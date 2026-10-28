import React, { useEffect, useState, useMemo } from 'react';
import { Card, InfoBanner } from '../components/Card';
import {
  Info,
  Link2,
  CheckCircle2,
  Clock,
  ShieldCheck,
  TrendingUp,
  Calculator,
  Receipt,
  AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BROKER_META } from '../data/mockData';

export default function BrokerComparison() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState({
    UPSTOX: true,
    DHAN: true,
    ANGEL_ONE: true,
    GROWW: true,
    ZERODHA: true,
    KOTAK_NEO: true,
    KOTAK_NEO_YOUTH: true,
  });
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'segments' | 'amc' | 'calculator'

  // Quick Calculator State
  const [calcSegment, setCalcSegment] = useState('EQUITY_INTRADAY'); // EQUITY_DELIVERY, EQUITY_INTRADAY, FUTURES, OPTIONS, COMMODITY
  const [calcTradeValue, setCalcTradeValue] = useState(100000); // 1 Lakh turnover
  const [calcOrders, setCalcOrders] = useState(2); // Buy + Sell
  const [calcDaysOnboarding, setCalcDaysOnboarding] = useState(45); // >30 days default (after introductory period)
  const [calcIsPhysicalDelivery, setCalcIsPhysicalDelivery] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadBrokers() {
      setLoading(true);
      setError('');
      try {
        const response = await api.brokerComparison();
        if (active) {
          setBrokers(response?.data?.brokers || []);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Failed to load broker comparison');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadBrokers();
    return () => { active = false; };
  }, []);

  const rows = useMemo(() => {
    return brokers.filter((r) => visible[r.broker] !== false);
  }, [brokers, visible]);

  // Unified Audited Brokerage Calculation matching backend brokerConfig.js
  const calculateBrokerage = (brokerKey) => {
    const orders = Number(calcOrders) || 1;
    const turnover = Number(calcTradeValue) || 0;
    const turnoverPerOrder = orders > 0 ? turnover / orders : turnover;
    const isWithin30Days = Number(calcDaysOnboarding) <= 30;

    switch (brokerKey) {
      case 'UPSTOX': {
        // Equity Delivery: fixed ₹20 per executed order (no 2.5%)
        if (calcSegment === 'EQUITY_DELIVERY') return 20 * orders;
        // Equity Intraday: lower of ₹20 or 0.1% of order turnover
        if (calcSegment === 'EQUITY_INTRADAY') {
          return orders * Math.min(20, turnoverPerOrder * 0.001);
        }
        // Equity Futures: lower of ₹20 or 0.05%
        if (calcSegment === 'FUTURES') {
          return orders * Math.min(20, turnoverPerOrder * 0.0005);
        }
        // Equity Options: ₹20 per executed order
        if (calcSegment === 'OPTIONS') return 20 * orders;
        // Commodities: lower of ₹20 or 0.05% (Fut) / ₹20 (Opt)
        if (calcSegment === 'COMMODITY') {
          return orders * Math.min(20, turnoverPerOrder * 0.0005);
        }
        return 20 * orders;
      }

      case 'DHAN': {
        // Equity Delivery: ₹0 brokerage for life
        if (calcSegment === 'EQUITY_DELIVERY') return 0;
        // Equity Intraday: lower of ₹20 or 0.03%
        if (calcSegment === 'EQUITY_INTRADAY') {
          return orders * Math.min(20, turnoverPerOrder * 0.0003);
        }
        // Equity Futures: FIXED ₹20 per executed order (not lower of 0.03%)
        if (calcSegment === 'FUTURES') {
          if (calcIsPhysicalDelivery) return turnover * 0.001; // 0.10% physical delivery
          return 20 * orders;
        }
        // Equity Options: ₹20 per executed order
        if (calcSegment === 'OPTIONS') return 20 * orders;
        // Commodity Futures & Options: FIXED ₹20 per executed order
        if (calcSegment === 'COMMODITY') return 20 * orders;
        return 20 * orders;
      }

      case 'ANGEL_ONE': {
        // Angel One introductory offer: up to ₹500 waived during first 30 days
        let standardFee = 0;
        if (calcSegment === 'EQUITY_DELIVERY') {
          // Lower of ₹20 or 0.1%, with ₹5 minimum per order
          standardFee = orders * Math.max(5, Math.min(20, turnoverPerOrder * 0.001));
        } else if (calcSegment === 'EQUITY_INTRADAY') {
          // Lower of ₹20 or 0.1%, with ₹5 minimum per order
          standardFee = orders * Math.max(5, Math.min(20, turnoverPerOrder * 0.001));
        } else if (calcSegment === 'FUTURES' || calcSegment === 'OPTIONS' || calcSegment === 'COMMODITY') {
          standardFee = 20 * orders;
        } else {
          standardFee = 20 * orders;
        }

        if (isWithin30Days) {
          // Capped at ₹500 discount
          const discount = Math.min(500, standardFee);
          return Math.max(0, standardFee - discount);
        }
        return standardFee;
      }

      // ✅ GROWW (Lower of ₹20 or 0.05% for equity, flat ₹20 for F&O)
      case 'GROWW': {
        if (calcSegment === 'EQUITY_DELIVERY' || calcSegment === 'EQUITY_INTRADAY') {
          return orders * Math.min(20, turnoverPerOrder * 0.0005);
        }
        if (calcSegment === 'FUTURES' || calcSegment === 'OPTIONS') {
          return 20 * orders;
        }
        if (calcSegment === 'COMMODITY') {
          return 0; // Commodity not offered via Groww API
        }
        return 20 * orders;
      }

      // ✅ ZERODHA (Zero for Equity Delivery, lower of ₹20 or 0.03% for Intraday/Futures, flat ₹20 for Options)
      case 'ZERODHA': {
        if (calcSegment === 'EQUITY_DELIVERY') {
          return 0; // ₹0 Free Equity Delivery
        }
        if (calcSegment === 'EQUITY_INTRADAY' || calcSegment === 'FUTURES' || calcSegment === 'COMMODITY') {
          return orders * Math.min(20, turnoverPerOrder * 0.0003);
        }
        if (calcSegment === 'OPTIONS') {
          return 20 * orders;
        }
        return 20 * orders;
      }

      case 'KOTAK_NEO': {
        // Trade Free Plan (Standard / 30+ yrs)
        if (isWithin30Days) {
          // ₹0 for first 30 days across Delivery, Intraday & F&O
          return 0;
        }
        // After first 30 days:
        if (calcSegment === 'EQUITY_DELIVERY') {
          return turnover * 0.002; // 0.20% of trade value
        }
        if (calcSegment === 'EQUITY_INTRADAY') {
          return orders * Math.min(10, turnoverPerOrder * 0.0005); // lower of ₹10 or 0.05%
        }
        if (calcSegment === 'FUTURES' || calcSegment === 'OPTIONS' || calcSegment === 'COMMODITY') {
          return 10 * orders; // ₹10 per executed order
        }
        return 10 * orders;
      }

      case 'KOTAK_NEO_YOUTH': {
        // Trade Free Youth (<30 yrs)
        if (isWithin30Days) {
          return 0; // ₹0 for first 30 days on Intraday & F&O
        }
        if (calcSegment === 'EQUITY_DELIVERY') {
          return 0; // ₹0 Brokerage for life on Delivery
        }
        if (calcSegment === 'EQUITY_INTRADAY') {
          return orders * Math.min(10, turnoverPerOrder * 0.0005); // lower of ₹10 or 0.05%
        }
        if (calcSegment === 'FUTURES' || calcSegment === 'OPTIONS' || calcSegment === 'COMMODITY') {
          return 10 * orders; // ₹10 per executed order
        }
        return 10 * orders;
      }

      default:
        return 20 * orders;
    }
  };

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Broker Charges &amp; Pricing Comparison</h1>
          <p className="page-description">
            Audited official broker tariffs: Delivery, Intraday, F&amp;O, Commodities, Demat AMC, and DP fees.
          </p>
        </div>

        {/* TAB BUTTONS */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-tertiary)', padding: 4, borderRadius: 8 }}>
          <button
            id="tab-all"
            className={`btn btn-sm ${activeTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setActiveTab('all')}
          >
            <Receipt size={14} /> Full Comparison
          </button>
          <button
            id="tab-amc"
            className={`btn btn-sm ${activeTab === 'amc' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setActiveTab('amc')}
          >
            <Clock size={14} /> AMC &amp; Maintenance
          </button>
          <button
            id="tab-segments"
            className={`btn btn-sm ${activeTab === 'segments' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setActiveTab('segments')}
          >
            <TrendingUp size={14} /> F&amp;O &amp; Commodities
          </button>
          <button
            id="tab-calculator"
            className={`btn btn-sm ${activeTab === 'calculator' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setActiveTab('calculator')}
          >
            <Calculator size={14} /> Cost Calculator
          </button>
        </div>
      </div>

      <InfoBanner icon={Info}>
        All rates are verified against official published tariffs (Upstox, Dhan, Angel One, and Kotak Neo). Statutory charges (STT, Exchange turnover, SEBI charges, Stamp Duty, and 18% GST) are additional and regulated by the Government of India.
      </InfoBanner>

      {error && (
        <div className="info-banner" role="alert">
          Could not load broker data: {error}
        </div>
      )}

      {/* BROKER CARDS AT A GLANCE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
        {brokers.map((b) => {
          const meta = BROKER_META[b.broker] || { color: '#6366f1' };
          const isConnected = b.connection === 'Connected';
          return (
            <div
              key={b.broker}
              style={{
                background: 'var(--bg-secondary)',
                border: `1.5px solid ${visible[b.broker] !== false ? meta.color : 'var(--border)'}`,
                borderRadius: 12,
                padding: '16px 18px',
                position: 'relative',
                boxShadow: visible[b.broker] !== false ? `0 4px 20px ${meta.color}15` : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: `${meta.color}20`,
                      color: meta.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {meta.short || b.name[0]}
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{b.name}</h3>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.planName}</div>
                  </div>
                </div>

                {/* AMC Pill Badge */}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: b.amc?.subsequentFee === 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                    color: b.amc?.subsequentFee === 0 ? '#10b981' : '#60a5fa',
                    border: `1px solid ${b.amc?.subsequentFee === 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                  }}
                >
                  {b.amc?.subsequentFee === 0 ? 'Lifetime ₹0 AMC' : '1st Year Free AMC'}
                </span>
              </div>

              {/* Quick Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Equity Delivery</div>
                  <div style={{ fontWeight: 600, color: b.delivery.includes('₹0') ? '#10b981' : 'var(--text-primary)' }}>{b.delivery}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Equity Intraday</div>
                  <div style={{ fontWeight: 600, color: b.intraday.includes('₹0') ? '#10b981' : 'var(--text-primary)' }}>{b.intraday}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Futures &amp; Options</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.options}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>DP Charge (Sell)</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.dpCharges.split(' ')[0]}</div>
                </div>
              </div>

              {/* AMC Summary Line */}
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 10 }}>
                <strong>AMC:</strong> {b.amc?.display}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <label className="checkbox" style={{ fontSize: 12, margin: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={visible[b.broker] !== false}
                    onChange={(e) => setVisible((v) => ({ ...v, [b.broker]: e.target.checked }))}
                  />
                  Compare in table
                </label>

                {!isConnected && (
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => navigate('/app/broker-accounts/new')}
                  >
                    <Link2 size={11} /> Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* TAB 1: FULL COMPARISON TABLE */}
      {activeTab === 'all' && (
        <Card padded={false} style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Audited Official Charges &amp; Tariff Comparison</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Side-by-side comparison across all account, trading segment, and depository fees.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)' }}>Show:</span>
              {brokers.map((b) => (
                <label key={b.broker} className="checkbox" style={{ fontSize: 12, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={visible[b.broker] !== false}
                    onChange={(e) => setVisible((v) => ({ ...v, [b.broker]: e.target.checked }))}
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 170 }}>Fee Category</th>
                  {rows.map((r) => (
                    <th key={r.broker} style={{ minWidth: 200, color: BROKER_META[r.broker]?.color }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: BROKER_META[r.broker]?.color }} />
                        {r.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{r.planName}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={rows.length + 1} style={{ textAlign: 'center', padding: 32 }}>Loading broker charges…</td>
                  </tr>
                ) : (
                  <>
                    {/* SECTION: ACCOUNT CHARGES */}
                    <tr style={{ background: 'var(--bg-tertiary)', fontWeight: 600 }}>
                      <td colSpan={rows.length + 1} style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Account Opening &amp; Demat Maintenance (AMC)
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Account Opening Fee</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>One-time registration</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker}>
                          <div className="mono" style={{ fontWeight: 600, color: r.accountOpening.includes('₹0') ? '#10b981' : 'var(--text-primary)' }}>
                            {r.accountOpening}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {r.accountOpeningDetails}
                          </div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          Yearly Maintenance (AMC) <Clock size={13} style={{ color: '#f59e0b' }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Annual Demat maintenance fee</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker}>
                          <div style={{ fontWeight: 600, color: r.amc?.subsequentFee === 0 ? '#10b981' : '#60a5fa' }}>
                            {r.amc?.display}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {r.amc?.details}
                          </div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>SEBI BSDA Exemption</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Basic Services Demat Account</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                          {r.amc?.bsdaConditions || (r.amc?.subsequentFee === 0 ? 'Not applicable (already 100% Zero AMC for Life)' : 'Eligible for ₹0 AMC under SEBI BSDA if holdings < ₹4 Lakhs.')}
                        </td>
                      ))}
                    </tr>

                    {/* SECTION: BROKERAGE BY SEGMENT */}
                    <tr style={{ background: 'var(--bg-tertiary)', fontWeight: 600 }}>
                      <td colSpan={rows.length + 1} style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Trading Segment Brokerage
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Equity Delivery</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cash buy and hold in Demat</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ color: r.delivery.includes('₹0') ? '#10b981' : 'var(--text-primary)', fontWeight: 600 }}>
                          {r.delivery}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Equity Intraday</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Same day buy &amp; sell orders</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ color: r.intraday.includes('₹0') ? '#10b981' : 'var(--text-primary)', fontWeight: 600 }}>
                          {r.intraday}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Equity &amp; Index Futures</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>NSE/BSE Futures contracts</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ fontWeight: 600 }}>
                          {r.futures}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Equity &amp; Index Options</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Call &amp; Put options execution</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ fontWeight: 600 }}>
                          {r.options}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Commodities (MCX)</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gold, Silver, Crude, Natural Gas</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ fontWeight: 600 }}>
                          {r.commodities}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Currency F&amp;O</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>USDINR, EURINR, GBPINR</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono">
                          {r.currency}
                        </td>
                      ))}
                    </tr>

                    {/* SECTION: PROMOTIONAL OFFERS */}
                    <tr style={{ background: 'var(--bg-tertiary)', fontWeight: 600 }}>
                      <td colSpan={rows.length + 1} style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Introductory Offers &amp; Waivers
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>First 30 Days Offer</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Onboarding promo terms</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {r.promotionalOffer?.display || 'Standard verified tariff applies from day 1.'}
                        </td>
                      ))}
                    </tr>

                    {/* SECTION: DEPOSITORY & TRANSACTION CHARGES */}
                    <tr style={{ background: 'var(--bg-tertiary)', fontWeight: 600 }}>
                      <td colSpan={rows.length + 1} style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Depository (DP) &amp; Operational Fees
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>DP Charges (Delivery Sell)</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>CDSL/NSDL debit fee per ISIN/scrip</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono" style={{ fontWeight: 600 }}>
                          {r.dpCharges}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Auto Square-Off</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>RMS fee if not closed by 3:20 PM</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono">
                          {r.autoSquareOff}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Call &amp; Trade</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Orders placed via phone dealer desk</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} className="mono">
                          {r.callAndTrade}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>
                        <div>Trading API Access</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Automated &amp; algorithmic API access</div>
                      </td>
                      {rows.map((r) => (
                        <td key={r.broker} style={{ color: '#10b981', fontWeight: 600 }}>
                          {r.apiCharges}
                        </td>
                      ))}
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 2: AMC & MAINTENANCE DEEP DIVE */}
      {activeTab === 'amc' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginBottom: 24 }}>
          {brokers.map((b) => {
            const meta = BROKER_META[b.broker] || { color: '#6366f1' };
            const isLifetimeFree = b.amc?.subsequentFee === 0;
            return (
              <Card key={b.broker}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: meta.color }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{b.name}</h3>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.planName}</div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: isLifetimeFree ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                      color: isLifetimeFree ? '#10b981' : '#60a5fa',
                      border: `1px solid ${isLifetimeFree ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                    }}
                  >
                    {isLifetimeFree ? 'Zero AMC for Life' : '1st Year Free'}
                  </span>
                </div>

                <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yearly Maintenance Charge (AMC):</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: isLifetimeFree ? '#10b981' : 'var(--text-primary)', margin: '4px 0 2px' }}>
                    {b.amc?.display}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    <strong>Account Opening:</strong> {b.accountOpening}
                  </div>
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
                  {b.amc?.details}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <ShieldCheck size={14} style={{ color: '#10b981' }} />
                    <span><strong>SEBI BSDA Exemption:</strong> {b.amc?.bsdaConditions || 'Free Demat holding under ₹4 Lakhs.'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={14} style={{ color: '#60a5fa' }} />
                    <span><strong>Opening Terms:</strong> {b.accountOpeningDetails}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* TAB 3: F&O, COMMODITIES & CURRENCY DETAILS */}
      {activeTab === 'segments' && (
        <Card padded={false} style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Derivatives &amp; Commodities Verified Tariffs</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Exact execution rates for Equity Futures, Index Options, MCX Commodities &amp; Currencies.</p>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Broker &amp; Plan</th>
                  <th>Equity Delivery</th>
                  <th>Equity Intraday</th>
                  <th>Equity / Index Futures</th>
                  <th>Equity / Index Options</th>
                  <th>Commodities (MCX)</th>
                  <th>Currency (NSE/BSE)</th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b) => {
                  const meta = BROKER_META[b.broker];
                  return (
                    <tr key={b.broker}>
                      <td>
                        <div style={{ fontWeight: 600, color: meta?.color }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.planName}</div>
                      </td>
                      <td className="mono" style={{ color: b.delivery.includes('₹0') ? '#10b981' : 'var(--text-primary)' }}>{b.delivery}</td>
                      <td className="mono" style={{ color: b.intraday.includes('₹0') ? '#10b981' : 'var(--text-primary)' }}>{b.intraday}</td>
                      <td className="mono">{b.futures}</td>
                      <td className="mono">{b.options}</td>
                      <td className="mono">{b.commodities}</td>
                      <td className="mono">{b.currency}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 4: INTERACTIVE COST CALCULATOR */}
      {activeTab === 'calculator' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: 20, marginBottom: 24 }}>
          <Card>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Simulate Trade Costs</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              Compare how much brokerage each broker charges for your specific trade scenario using the audited tariff logic.
            </p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>Trading Segment</label>
              <select
                className="filter-select"
                style={{ width: '100%' }}
                value={calcSegment}
                onChange={(e) => setCalcSegment(e.target.value)}
              >
                <option value="EQUITY_INTRADAY">Equity Intraday (Stock)</option>
                <option value="EQUITY_DELIVERY">Equity Delivery (Cash &amp; Hold)</option>
                <option value="FUTURES">Futures (Nifty / BankNifty / Stocks)</option>
                <option value="OPTIONS">Options (Index / Stock Options)</option>
                <option value="COMMODITY">Commodity (Crude / Gold / MCX)</option>
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Turnover / Trade Value (₹): <strong>₹{Number(calcTradeValue).toLocaleString('en-IN')}</strong>
              </label>
              <input
                type="number"
                min="1000"
                step="5000"
                value={calcTradeValue}
                onChange={(e) => setCalcTradeValue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Executed Orders: <strong>{calcOrders}</strong> (Buy + Sell = 2 orders)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={calcOrders}
                onChange={(e) => setCalcOrders(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Account Age: <strong>{calcDaysOnboarding} days</strong>
              </label>
              <select
                className="filter-select"
                style={{ width: '100%' }}
                value={calcDaysOnboarding}
                onChange={(e) => setCalcDaysOnboarding(Number(e.target.value))}
              >
                <option value={15}>Within First 30 Days (Introductory Offer active)</option>
                <option value={45}>After First 30 Days (Standard tariff rates)</option>
              </select>
            </div>

            {calcSegment === 'FUTURES' && (
              <div style={{ marginBottom: 16 }}>
                <label className="checkbox" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={calcIsPhysicalDelivery}
                    onChange={(e) => setCalcIsPhysicalDelivery(e.target.checked)}
                  />
                  Contract settled via physical delivery (0.10% Dhan surcharge)
                </label>
              </div>
            )}
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Estimated Brokerage Comparison</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 14 }}>
              {brokers.map((b) => {
                const meta = BROKER_META[b.broker];
                const fee = calculateBrokerage(b.broker);
                const isZero = fee === 0;
                return (
                  <div
                    key={b.broker}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: `1.5px solid ${isZero ? '#10b981' : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: 16,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: meta?.color, marginBottom: 2 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{b.planName}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: isZero ? '#10b981' : 'var(--text-primary)', margin: '8px 0' }}>
                      ₹{fee.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: isZero ? '#10b981' : 'var(--text-muted)' }}>
                      {isZero ? '🎉 Zero Brokerage!' : `Brokerage for ${calcOrders} order(s)`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                      AMC: {b.amc?.display.split(',')[0]}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 20, padding: '10px 14px', borderRadius: 8, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
              💡 <strong>Note:</strong> Brokerage shown above excludes statutory charges (STT, Exchange transaction charges, SEBI charges, Stamp Duty, and 18% GST), which are legally identical across all brokers in India under Ministry of Finance &amp; SEBI regulations.
            </div>
          </Card>
        </div>
      )}

      {/* SEBI BSDA REGULATORY GUIDELINES EXPLANATION */}
      <Card style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ShieldCheck size={18} style={{ color: '#10b981' }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>SEBI Demat AMC Regulations &amp; BSDA Norms</h3>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
          Under SEBI circular guidelines, every Indian retail investor is eligible for a <strong>Basic Services Demat Account (BSDA)</strong>.
          If your total portfolio holding value across debt &amp; equity is below <strong>₹4,00,000</strong>, Annual Maintenance Charges (AMC) are strictly capped or completely <strong>₹0 (Free)</strong> across all depositories (CDSL &amp; NSDL).
          Brokers like <strong>Dhan</strong> offer <strong>Zero AMC for Life</strong> unconditionally on all individual accounts regardless of portfolio size, while <strong>Upstox</strong>, <strong>Angel One</strong>, and <strong>Kotak Neo</strong> provide the <strong>1st Year 100% Free</strong>.
        </p>
      </Card>
    </>
  );
}
