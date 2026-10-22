import React, { useEffect, useState } from 'react';
import { Card, StatCard, InfoBanner } from '../components/Card';
import { Info, AlertTriangle, ShieldCheck, ShieldAlert, Save, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

const DEFAULT_PREFS = {
  dailyLimit: 15000,
  riskPerTrade: 1.5,
  maxExposure: 100000,
  enforceBreaker: true
};

export default function RiskManagement() {
  const toast = useToast();

  const [prefs, setPrefs] = useState(() => {
    try {
      const stored = localStorage.getItem('tg_risk_prefs');
      return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  });

  const [dailyLimitInput, setDailyLimitInput] = useState(String(prefs.dailyLimit));
  const [maxExposureInput, setMaxExposureInput] = useState(String(prefs.maxExposure));
  const [riskPerTrade, setRiskPerTrade] = useState(prefs.riskPerTrade);
  const [enforceBreaker, setEnforceBreaker] = useState(prefs.enforceBreaker ?? true);

  const [exposures, setExposures] = useState([]);
  const [riskStats, setRiskStats] = useState({
    totalExposure: 0,
    maxDrawdown: 0,
    todayPnL: 0,
    openPositionsCount: 0,
    closedPositionsCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadExposures = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.riskExposures();
      if (response?.data) {
        setExposures(response.data.exposures || []);
        setRiskStats({
          totalExposure: response.data.totalExposure || 0,
          maxDrawdown: response.data.maxDrawdown || 0,
          todayPnL: response.data.todayPnL || 0,
          openPositionsCount: response.data.openPositionsCount || 0,
          closedPositionsCount: response.data.closedPositionsCount || 0
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to load risk exposures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExposures();
  }, []);

  const dailyLimitNum = Math.max(100, Number(dailyLimitInput) || 15000);
  const maxExposureNum = Math.max(1000, Number(maxExposureInput) || 100000);

  const totalExposure = exposures.reduce((sum, e) => sum + (e.exposureAmount || (e.avgPrice * e.quantity)), 0);
  const exposurePct = maxExposureNum > 0 ? Math.min((totalExposure / maxExposureNum) * 100, 100) : 0;

  const todayLoss = Math.max(0, -riskStats.todayPnL);
  const dailyLossPct = dailyLimitNum > 0 ? Math.min((todayLoss / dailyLimitNum) * 100, 100) : 0;

  const isBreached = todayLoss >= dailyLimitNum;
  const isWarning = dailyLossPct >= 70 && !isBreached;

  const handleSavePreferences = () => {
    const updated = {
      dailyLimit: dailyLimitNum,
      riskPerTrade,
      maxExposure: maxExposureNum,
      enforceBreaker
    };
    try {
      localStorage.setItem('tg_risk_prefs', JSON.stringify(updated));
      setPrefs(updated);
      toast.push('Risk guardrail preferences saved successfully!', 'success');
    } catch (e) {
      toast.push('Failed to save preferences: ' + e.message, 'error');
    }
  };

  const applyPresetLimit = (amount) => {
    setDailyLimitInput(String(amount));
  };

  return (
    <>
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Risk management</h1>
          <p className="page-description">Configure day loss limits, trade guardrails, and monitor capital exposure in real-time.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadExposures} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh metrics</span>
        </button>
      </div>

      <InfoBanner icon={Info}>
        Daily loss limits and position guardrails protect trading capital against adverse intraday swings. All monetary values are strictly in Indian Rupee (₹).
      </InfoBanner>

      {error && (
        <div className="info-banner" role="alert">
          Could not load exposure data: {error}
        </div>
      )}

      {isBreached && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 'var(--radius)',
            padding: '16px 20px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <ShieldAlert size={24} color="var(--danger)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 15 }}>
              Circuit Breaker Triggered: Daily Loss Limit Breached!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              Today's loss of ₹{todayLoss.toLocaleString('en-IN')} has reached or exceeded your configured limit of ₹{dailyLimitNum.toLocaleString('en-IN')}. Please cease all active trading for the remainder of the session.
            </div>
          </div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard
          label="Daily loss limit"
          value={`₹${dailyLimitNum.toLocaleString('en-IN')}`}
          change={`${dailyLossPct.toFixed(1)}% consumed today`}
          changeType={isBreached ? 'negative' : isWarning ? 'negative' : 'positive'}
        />
        <StatCard
          label="Today's Realized Loss"
          value={`₹${todayLoss.toLocaleString('en-IN')}`}
          change={riskStats.todayPnL >= 0 ? `Profitable (+₹${riskStats.todayPnL.toLocaleString('en-IN')})` : 'Net loss today'}
          changeType={todayLoss > 0 ? 'negative' : 'positive'}
        />
        <StatCard
          label="Max drawdown"
          value={`₹${riskStats.maxDrawdown.toLocaleString('en-IN')}`}
          change="Historical peak drop"
          changeType="neutral"
        />
        <StatCard
          label="Total exposure"
          value={`₹${Math.round(totalExposure).toLocaleString('en-IN')}`}
          change={`${exposures.length} open position(s)`}
          changeType="neutral"
        />
        <StatCard
          label="Exposure used"
          value={`${exposurePct.toFixed(1)}%`}
          change={`Of ₹${maxExposureNum.toLocaleString('en-IN')} max`}
          changeType={exposurePct > 75 ? 'negative' : 'positive'}
        />
        <StatCard
          label="Risk per trade"
          value={`${riskPerTrade.toFixed(1)}%`}
          change="Account equity risk"
          changeType="neutral"
        />
      </div>

      <div className="grid-2">
        <Card title="Exposure &amp; Position Guardrails" subtitle="Open positions from your broker executions">
          {loading ? (
            <p>Loading exposures…</p>
          ) : exposures.length === 0 ? (
            <div style={{ minHeight: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 20, gap: 10 }}>
              <ShieldCheck size={36} color="var(--emerald)" />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>Zero overnight risk exposure</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>All historical positions are closed. No active open market risk detected.</div>
              </div>
            </div>
          ) : (
            exposures.map((e) => {
              const value = e.exposureAmount || (e.avgPrice * e.quantity);
              const pct = Math.min((value / maxExposureNum) * 100, 100);
              return (
                <div className="progress-row" key={e.instrument}>
                  <div className="progress-header">
                    <div>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{e.instrument}</span>
                      <span className={`badge ${e.direction === 'LONG' ? 'badge-success' : 'badge-danger'}`} style={{ marginLeft: 8, fontSize: 10 }}>
                        {e.direction || 'LONG'} {e.quantity} qty
                      </span>
                    </div>
                    <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                      ₹{Math.round(value).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${pct > 75 ? 'warning' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}

          <div style={{ marginTop: 24, padding: 16, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Daily Loss Limit Meter</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: isBreached ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--emerald)' }}>
                {dailyLossPct.toFixed(1)}% Used (₹{todayLoss.toLocaleString('en-IN')} / ₹{dailyLimitNum.toLocaleString('en-IN')})
              </span>
            </div>
            <div className="progress-bar" style={{ height: 8 }}>
              <div
                className={`progress-fill ${isBreached ? 'danger' : isWarning ? 'warning' : ''}`}
                style={{
                  width: `${dailyLossPct}%`,
                  background: isBreached ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--emerald)'
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>₹0</span>
              <span>Warning (70%)</span>
              <span>Hard Stop (₹{dailyLimitNum.toLocaleString('en-IN')})</span>
            </div>
          </div>
        </Card>

        <Card title="Risk guardrail preferences" subtitle="Adjust parameters and click save to persist your risk limits">
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="form-label" style={{ margin: 0 }}>Day loss limit (₹)</label>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Active: ₹{dailyLimitNum.toLocaleString('en-IN')}</span>
            </div>
            <input
              type="number"
              min="100"
              step="500"
              className="form-input"
              value={dailyLimitInput}
              onChange={(e) => setDailyLimitInput(e.target.value)}
              placeholder="e.g. 15000"
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>Quick presets:</span>
              {[5000, 10000, 15000, 25000, 50000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPresetLimit(preset)}
                  className={`btn btn-sm ${dailyLimitNum === preset ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  ₹{(preset / 1000)}k
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div className="flex justify-between items-center mb-2">
              <label className="form-label" style={{ margin: 0 }}>Risk per trade (% of equity)</label>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                {riskPerTrade.toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={riskPerTrade}
              onChange={(e) => setRiskPerTrade(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>0.5% (Conservative)</span>
              <span>1.5% (Recommended)</span>
              <span>5.0% (Aggressive)</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Maximum portfolio exposure limit (₹)</label>
            <input
              type="number"
              min="1000"
              step="5000"
              className="form-input"
              value={maxExposureInput}
              onChange={(e) => setMaxExposureInput(e.target.value)}
              placeholder="e.g. 100000"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 20 }}>
            <input
              type="checkbox"
              id="breakerToggle"
              checked={enforceBreaker}
              onChange={(e) => setEnforceBreaker(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 16, height: 16 }}
            />
            <label htmlFor="breakerToggle" style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
              Enable visual circuit breaker warnings upon reaching Day Loss Limit
            </label>
          </div>

          {exposurePct > 60 && (
            <div
              style={{
                background: 'var(--warning-bg)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 8,
                padding: 14,
                marginBottom: 20,
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Concentration warning</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Total exposure exceeds 60% of your maximum capital limit.
                </div>
              </div>
              <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>
                <span className="badge-dot" /> Warning
              </span>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={handleSavePreferences}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', fontWeight: 600 }}
          >
            <Save size={15} />
            <span>Save risk preferences</span>
          </button>
        </Card>
      </div>
    </>
  );
}
