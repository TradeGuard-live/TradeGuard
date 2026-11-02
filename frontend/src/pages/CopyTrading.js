import React, { useState, useEffect, useCallback } from 'react';
import { Card, StatCard, InfoBanner } from '../components/Card';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Play,
  Pause,
  Plus,
  Trash2,
  Zap,
  Clock,
  Activity,
  Layers,
  ArrowRight,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Send,
  X,
  Sliders,
  Settings,
  Scale,
  ArrowRightLeft
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

export default function CopyTrading() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'followers' | 'rules' | 'audit' | 'simulation'
  const [config, setConfig] = useState(null);
  const [streamStatus, setStreamStatus] = useState({ isConnected: false });
  const [metrics, setMetrics] = useState(null);
  const [orders, setOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [brokerAccounts, setBrokerAccounts] = useState([]);

  // Modals & Forms
  const [showFollowerModal, setShowFollowerModal] = useState(false);
  const [editingFollower, setEditingFollower] = useState(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [syncingMaster, setSyncingMaster] = useState(false);

  // Simulation Form State
  const [simForm, setSimForm] = useState({
    symbol: 'RELIANCE',
    exchange: 'NSE',
    segment: 'EQUITY',
    transactionType: 'BUY',
    orderType: 'MARKET',
    quantity: 10,
    price: 2500,
    operation: 'PLACE'
  });
  const [simulating, setSimulating] = useState(false);

  // Follower Form State
  const [followerForm, setFollowerForm] = useState({
    followerAccountId: '',
    followerBroker: 'MOCK',
    followerName: 'Follower Account',
    isEnabled: true,
    isPaused: false,
    sizingMode: 'MULTIPLIER',
    multiplier: 1.0,
    fixedQuantity: 1,
    maxOrderQuantity: 1800,
    maxOrderNotional: 500000,
    allowedSegments: ['EQUITY', 'FUTURES', 'OPTIONS'],
    allowedProducts: ['INTRADAY', 'DELIVERY', 'NORMAL'],
    allowedOrderTypes: ['MARKET', 'LIMIT', 'SL', 'SL-M'],
    copyNewOrders: true,
    copyModifications: true,
    copyCancellations: true,
    pauseOnFailure: true,
    roundingRule: 'ROUND_DOWN'
  });

  const loadData = useCallback(async () => {
    try {
      const [cfgRes, metRes, ordRes, accRes, logRes] = await Promise.all([
        api.getCopyTradingConfig(),
        api.getCopyMetrics(),
        api.getCopyOrders(1, 50),
        api.listBrokerAccounts(),
        api.getCopyAuditLogs(1, 50)
      ]);

      if (cfgRes?.data) {
        setConfig(cfgRes.data.config);
        setStreamStatus(cfgRes.data.streamStatus || { isConnected: false });
      }
      if (metRes?.data) setMetrics(metRes.data);
      if (ordRes?.data?.orders) setOrders(ordRes.data.orders);
      if (accRes?.data) setBrokerAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      if (logRes?.data?.logs) setAuditLogs(logRes.data.logs);
    } catch (err) {
      console.warn('Failed to load Copy Trading data:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    toast.push('Copy trading dashboard refreshed', 'success');
  };

  const handleToggleGlobal = async () => {
    if (!config) return;
    try {
      const updated = await api.updateCopyTradingConfig({
        isEnabled: !config.isEnabled
      });
      setConfig(updated.data);
      toast.push(
        updated.data.isEnabled ? 'Copy trading enabled globally' : 'Copy trading disabled',
        'info'
      );
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleTogglePause = async () => {
    if (!config) return;
    try {
      const updated = await api.updateCopyTradingConfig({
        isPaused: !config.isPaused
      });
      setConfig(updated.data);
      toast.push(
        updated.data.isPaused ? 'Copy trading globally paused' : 'Copy trading resumed',
        'info'
      );
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleEmergencyStop = async () => {
    try {
      const res = await api.triggerEmergencyStop(emergencyReason || 'Emergency stop requested by operator');
      setConfig(res.data);
      setShowEmergencyModal(false);
      setEmergencyReason('');
      toast.push('EMERGENCY STOP TRIGGERED: All copy trading halted immediately', 'error');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleResetEmergency = async () => {
    try {
      const res = await api.resetEmergencyStop();
      setConfig(res.data);
      toast.push('Emergency stop reset. Engine is ready.', 'success');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await api.triggerCopyReconciliation();
      toast.push(res.message || 'Reconciliation completed', 'success');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setReconciling(false);
    }
  };

  const handleSyncMasterTrades = async () => {
    setSyncingMaster(true);
    try {
      const res = await api.syncMasterTrades();
      toast.push(res.message || 'Master trades synchronized and copied', 'success');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setSyncingMaster(false);
    }
  };

  const handleSaveFollower = async (e) => {
    e.preventDefault();
    try {
      if (editingFollower) {
        await api.updateFollower(editingFollower._id, followerForm);
        toast.push('Follower account updated successfully', 'success');
      } else {
        await api.addFollower(followerForm);
        toast.push('Follower account added successfully', 'success');
      }
      setShowFollowerModal(false);
      setEditingFollower(null);
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleDeleteFollower = async (followerId) => {
    if (!window.confirm('Are you sure you want to remove this follower account?')) return;
    try {
      await api.deleteFollower(followerId);
      toast.push('Follower account removed', 'success');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleToggleFollowerPause = async (follower) => {
    try {
      await api.updateFollower(follower._id, { isPaused: !follower.isPaused });
      toast.push(follower.isPaused ? `Resumed ${follower.followerName}` : `Paused ${follower.followerName}`, 'info');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  };

  const handleSimulateOrder = async (e) => {
    e.preventDefault();
    setSimulating(true);
    try {
      const res = await api.simulateMasterOrder(simForm);
      toast.push(res.message || 'Simulation master order dispatched', 'success');
      await loadData();
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setSimulating(false);
    }
  };

  const isEmergency = config?.emergencyStop;
  const isEngineActive = config?.isEnabled && !config?.isPaused && !isEmergency;

  const latencyStats = metrics?.latency?.processingLatency || {};
  const ackLatencyStats = metrics?.latency?.brokerAckLatency || {};
  const counts = metrics?.counts || {};

  return (
    <div className="copy-trading-container">
      {/* Top Header Bar */}
      <div className="page-header page-header-row" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Copy Trading Engine
            </h1>
            <span
              className={`live-ws-pill ${
                isEmergency
                  ? 'disconnected'
                  : isEngineActive
                  ? 'connected'
                  : 'connecting'
              }`}
            >
              <span className="live-ws-pulse" />
              {isEmergency
                ? 'EMERGENCY STOPPED'
                : isEngineActive
                ? 'Engine Active'
                : config?.isPaused
                ? 'Engine Paused'
                : 'Engine Disabled'}
            </span>

            <span
              className={`quote-badge ${
                streamStatus.isConnected ? 'quote-badge-live' : 'quote-badge-closed'
              }`}
            >
              {streamStatus.isConnected ? '🟢 Master Stream Live' : '⚪ Master Offline'}
            </span>
          </div>
          <p className="page-description" style={{ marginTop: 4 }}>
            Local-first, sub-millisecond multi-broker order replication with fail-closed risk controls and exactly-once idempotency.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={refreshing ? 'spinner-rotate' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleReconcile}
            disabled={reconciling}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title="Reconcile ambiguous or unknown order outcomes against broker order books"
          >
            <Scale size={14} className={reconciling ? 'spinner-rotate' : ''} />
            {reconciling ? 'Reconciling...' : 'Reconcile States'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleSyncMasterTrades}
            disabled={syncingMaster}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title="Scan today's executed trades on Dhan master and copy any uncopied trades to followers"
          >
            <ArrowRightLeft size={14} className={syncingMaster ? 'spinner-rotate' : ''} />
            {syncingMaster ? 'Syncing...' : 'Sync Master Trades'}
          </button>

          {config && !isEmergency && (
            <button
              className={`btn ${config.isPaused ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleTogglePause}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {config.isPaused ? <Play size={14} /> : <Pause size={14} />}
              {config.isPaused ? 'Resume Copying' : 'Pause All'}
            </button>
          )}

          {isEmergency ? (
            <button className="btn btn-primary" onClick={handleResetEmergency}>
              <ShieldCheck size={14} />
              Reset Emergency Stop
            </button>
          ) : (
            <button
              className="btn btn-danger"
              onClick={() => setShowEmergencyModal(true)}
              style={{
                background: '#ef4444',
                borderColor: '#dc2626',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600
              }}
            >
              <ShieldAlert size={15} />
              Emergency Stop (Kill Switch)
            </button>
          )}
        </div>
      </div>

      {isEmergency && (
        <div
          className="info-banner"
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            marginBottom: 20
          }}
        >
          <AlertTriangle size={18} />
          <div style={{ flex: 1 }}>
            <strong>CRITICAL: Emergency Stop Active</strong> —{' '}
            {config.emergencyStopReason || 'Trading halted'}. All master event processing is suspended. Click "Reset Emergency Stop" above after verifying broker states.
          </div>
        </div>
      )}

      {/* Top 4 Metrics Cards */}
      <div className="stat-grid live-stat-grid" style={{ marginBottom: 24 }}>
        {/* Card 1: Master Broker & Connection */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Master Account</span>
            <Shield size={16} style={{ color: '#38bdf8' }} />
          </div>
          <div className="live-card-value" style={{ color: '#38bdf8', fontSize: 20 }}>
            {config?.masterBroker || 'MOCK'} · {String(config?.masterAccountId || 'MOCK_MASTER').slice(0, 14)}
          </div>
          <div className="live-card-sub">
            <span>{streamStatus.isConnected ? 'Stream Connected' : 'Stream Standby'}</span>
            <button
              className="text-btn"
              onClick={handleToggleGlobal}
              style={{ color: config?.isEnabled ? '#10b981' : '#f87171', fontWeight: 600 }}
            >
              {config?.isEnabled ? '● Active' : '○ Disabled'}
            </button>
          </div>
        </div>

        {/* Card 2: Active Followers */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Active Followers</span>
            <Layers size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div className="live-card-value" style={{ color: '#c4b5fd', fontSize: 22 }}>
            {(config?.followers || []).filter((f) => f.isEnabled && !f.isPaused).length} /{' '}
            {(config?.followers || []).length} Accounts
          </div>
          <div className="live-card-sub">
            <span>Configured Ratios: {config?.followers?.map((f) => `${f.multiplier}x`).join(', ') || '1x'}</span>
            <span className="live-rr-tag">Parallel Dispatch</span>
          </div>
        </div>

        {/* Card 3: Orders Copied Today */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Orders Copied Today</span>
            <Activity size={16} style={{ color: '#10b981' }} />
          </div>
          <div className="live-card-value" style={{ color: '#10b981', fontSize: 22 }}>
            {counts.totalCopiedToday || orders.length} Executed
          </div>
          <div className="live-card-sub">
            <span style={{ color: '#34d399' }}>Filled: {counts.filledToday || 0}</span>
            <span style={{ color: '#f87171' }}>Rejected: {counts.rejectedToday || 0}</span>
          </div>
        </div>

        {/* Card 4: Measured Latency Metrics */}
        <div className="live-card">
          <div className="live-card-header">
            <span className="live-card-label">Local Engine Latency</span>
            <Zap size={16} style={{ color: '#fbbf24' }} />
          </div>
          <div className="live-card-value" style={{ color: '#fbbf24', fontSize: 22 }}>
            p50: {latencyStats.p50 || 0}ms · p95: {latencyStats.p95 || 0}ms
          </div>
          <div className="live-card-sub">
            <span>Broker Ack p50: {ackLatencyStats.p50 || 0}ms</span>
            <span className="live-badge-glow">Monotonic Clock</span>
          </div>
        </div>
      </div>

      {/* Main Container Card with Tab Navigation */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="live-tabs-header">
          <div className="live-tab-buttons">
            <button
              className={`live-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
              onClick={() => setActiveTab('orders')}
            >
              Order Synchronization ({orders.length})
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'followers' ? 'active' : ''}`}
              onClick={() => setActiveTab('followers')}
            >
              Follower Accounts ({(config?.followers || []).length})
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
              onClick={() => setActiveTab('rules')}
            >
              Master Account &amp; Copy Rules
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              Audit &amp; Diagnostics ({auditLogs.length})
            </button>
            <button
              className={`live-tab-btn ${activeTab === 'simulation' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulation')}
              style={{ color: '#fbbf24' }}
            >
              Local Simulation / Test Mode
            </button>
          </div>
        </div>

        {/* TAB 1: ORDER SYNCHRONIZATION TABLE */}
        {activeTab === 'orders' && (
          <div className="table-responsive">
            <table className="data-table live-table">
              <thead>
                <tr>
                  <th>Event Time</th>
                  <th>Master Order ID</th>
                  <th>Instrument &amp; Exchange</th>
                  <th>Side / Type</th>
                  <th>Master Qty / Filled</th>
                  <th>Follower Account</th>
                  <th>Follower Order ID</th>
                  <th>Follower Qty</th>
                  <th>Follower State</th>
                  <th>Latency</th>
                  <th>Result / Details</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                      No orders synchronized yet. Start the engine or execute a simulated master order to observe real-time copying.
                    </td>
                  </tr>
                ) : (
                  orders.map((ord) => {
                    const isBuy = ord.transactionType === 'BUY';
                    const isFilled = ord.followerStatus === 'FILLED';
                    const isRejected = ord.followerStatus === 'REJECTED' || ord.followerStatus === 'FAILED';
                    const isAck = ord.followerStatus === 'ACKNOWLEDGED';

                    return (
                      <tr key={ord._id || ord.idempotencyKey}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {new Date(ord.createdAt).toLocaleTimeString()}
                        </td>
                        <td>
                          <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {ord.masterOrderId}
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {ord.masterBroker} · {ord.masterOrderStatus}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{ord.symbol}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {ord.exchange} · {ord.segment} · {ord.productCode}
                          </div>
                        </td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: isBuy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isBuy ? '#10b981' : '#ef4444',
                              fontWeight: 600
                            }}
                          >
                            {ord.transactionType}
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {ord.orderType}
                          </div>
                        </td>
                        <td className="mono">
                          {ord.masterQuantity} ({ord.masterFilledQuantity} filled)
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{ord.followerBroker}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {ord.followerAccountId}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {ord.followerOrderId || '—'}
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {ord.followerQuantity}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${
                              isFilled
                                ? 'pill-green'
                                : isAck
                                ? 'pill-blue'
                                : isRejected
                                ? 'pill-red'
                                : 'pill-orange'
                            }`}
                          >
                            {ord.followerStatus}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: '#fbbf24' }}>
                          {ord.timing?.latencyMs ? `${ord.timing.latencyMs}ms` : '—'}
                        </td>
                        <td style={{ fontSize: 11, maxWidth: 200 }}>
                          {ord.rejectionReason || ord.errorMessage || (isFilled ? 'Filled completely' : 'Synchronized')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: FOLLOWER ACCOUNTS & SIZING */}
        {activeTab === 'followers' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Configured Follower Accounts</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Configure independent multipliers, order sizing rules, segment permissions, and risk limits for each follower.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const avail = brokerAccounts.find(a => String(a._id) !== String(config?.masterAccountId));
                  setEditingFollower(null);
                  setFollowerForm({
                    followerAccountId: avail ? String(avail._id) : 'MOCK_FOLLOWER_01',
                    followerBroker: avail ? avail.broker : 'MOCK',
                    followerName: avail ? `${avail.broker} Follower` : 'Mock Follower',
                    isEnabled: true,
                    isPaused: false,
                    sizingMode: 'MULTIPLIER',
                    multiplier: 1.0,
                    fixedQuantity: 1,
                    maxOrderQuantity: 1800,
                    maxOrderNotional: 500000,
                    allowedSegments: ['EQUITY', 'FUTURES', 'OPTIONS'],
                    allowedProducts: ['INTRADAY', 'DELIVERY', 'NORMAL'],
                    allowedOrderTypes: ['MARKET', 'LIMIT', 'SL', 'SL-M'],
                    copyNewOrders: true,
                    copyModifications: true,
                    copyCancellations: true,
                    pauseOnFailure: true,
                    roundingRule: 'ROUND_DOWN'
                  });
                  setShowFollowerModal(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Plus size={15} />
                Add Follower Account
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
              {(config?.followers || []).map((f) => (
                <div key={f._id || f.followerAccountId} className="card" style={{ padding: 16, border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{f.followerName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {f.followerBroker} · ID: {String(f.followerAccountId).slice(0, 16)}
                      </div>
                    </div>
                    <span className={`status-pill ${f.isEnabled && !f.isPaused ? 'pill-green' : 'pill-red'}`}>
                      {!f.isEnabled ? 'Disabled' : f.isPaused ? 'Paused' : 'Active'}
                    </span>
                  </div>

                  <div style={{ margin: '14px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Sizing Mode:</span>{' '}
                      <strong>{f.sizingMode}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Multiplier:</span>{' '}
                      <strong>{f.multiplier}x</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Max Qty:</span>{' '}
                      <strong>{f.maxOrderQuantity}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Max Notional:</span>{' '}
                      <strong>₹{Number(f.maxOrderNotional || 0).toLocaleString('en-IN')}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
                    {(f.allowedSegments || []).map((s) => (
                      <span key={s} className="quote-badge quote-badge-live" style={{ fontSize: 10 }}>
                        {s}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleToggleFollowerPause(f)}
                    >
                      {f.isPaused ? <Play size={12} /> : <Pause size={12} />}
                      {f.isPaused ? 'Resume' : 'Pause'}
                    </button>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingFollower(f);
                          setFollowerForm({ ...f });
                          setShowFollowerModal(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => handleDeleteFollower(f._id)}
                        style={{ color: '#ef4444' }}
                        title="Delete follower"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: MASTER ACCOUNT & COPY RULES */}
        {activeTab === 'rules' && (
          <div style={{ padding: 24, maxWidth: 800 }}>
            <h3 style={{ marginTop: 0 }}>Master Account &amp; Operational Rules</h3>

            <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Master Broker Account</label>
                <select
                  className="filter-select"
                  value={config?.masterAccountId || 'MOCK_MASTER'}
                  onChange={async (e) => {
                    const selId = e.target.value;
                    const matched = brokerAccounts.find((a) => a._id === selId);
                    await api.updateCopyTradingConfig({
                      masterAccountId: selId,
                      masterBroker: matched ? matched.broker : 'MOCK'
                    });
                    loadData();
                  }}
                  style={{ width: '100%', maxWidth: 400 }}
                >
                  <option value="MOCK_MASTER">Deterministic Simulation Broker (Mock Master)</option>
                  {brokerAccounts.map((acc) => (
                    <option key={acc._id} value={acc._id}>
                      {acc.broker} ({acc.credentials?.clientId || acc._id})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="card" style={{ padding: 16 }}>
                  <h4>Order Synchronization Controls</h4>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={config?.followers?.[0]?.copyNewOrders ?? true}
                      readOnly
                    />
                    <span>Copy New Orders (Market / Limit)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={config?.followers?.[0]?.copyModifications ?? true}
                      readOnly
                    />
                    <span>Copy Order Modifications</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={config?.followers?.[0]?.copyCancellations ?? true}
                      readOnly
                    />
                    <span>Copy Order Cancellations</span>
                  </label>
                </div>

                <div className="card" style={{ padding: 16 }}>
                  <h4>Failsafe &amp; Risk Rules</h4>
                  <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <strong>Auto-pause on failure:</strong> Enabled (Follower pauses if broker rejects)
                    </div>
                    <div>
                      <strong>Default Rounding:</strong> ROUND_DOWN (Safety-first lot sizing)
                    </div>
                    <div>
                      <strong>Rate Limit:</strong> 10 orders / sec
                    </div>
                    <div>
                      <strong>Max Unresolved Operations:</strong> 20
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT & DIAGNOSTICS */}
        {activeTab === 'audit' && (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Severity</th>
                  <th>Message</th>
                  <th>Master Order ID</th>
                  <th>Follower Order ID</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No audit events logged yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log._id}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                          {log.eventType}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            log.severity === 'CRITICAL' || log.severity === 'ERROR'
                              ? 'badge-danger'
                              : log.severity === 'WARN'
                              ? 'badge-warning'
                              : 'badge-neutral'
                          }`}
                        >
                          {log.severity}
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>{log.message}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{log.masterOrderId || '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{log.followerOrderId || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 5: LOCAL SIMULATION TEST MODE */}
        {activeTab === 'simulation' && (
          <div style={{ padding: 24, maxWidth: 650 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Zap size={22} style={{ color: '#fbbf24' }} />
              <h3 style={{ margin: 0 }}>Simulated Master Order Injector</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
              Dispatch simulated trades locally to verify follower order replication, sizing multipliers, and latency metrics without placing live orders or spending real capital.
            </p>

            <form onSubmit={handleSimulateOrder} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Symbol</label>
                  <input
                    type="text"
                    className="form-input"
                    value={simForm.symbol}
                    onChange={(e) => setSimForm({ ...simForm, symbol: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Quantity</label>
                  <input
                    type="number"
                    className="form-input"
                    value={simForm.quantity}
                    onChange={(e) => setSimForm({ ...simForm, quantity: Number(e.target.value) })}
                    min="1"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Side</label>
                  <select
                    className="filter-select"
                    value={simForm.transactionType}
                    onChange={(e) => setSimForm({ ...simForm, transactionType: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="BUY">BUY (Long)</option>
                    <option value="SELL">SELL (Short)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Operation</label>
                  <select
                    className="filter-select"
                    value={simForm.operation}
                    onChange={(e) => setSimForm({ ...simForm, operation: e.target.value })}
                    style={{ width: '100%' }}
                  >
                    <option value="PLACE">PLACE (New Order)</option>
                    <option value="MODIFY">MODIFY (Change Qty/Price)</option>
                    <option value="CANCEL">CANCEL (Cancel Order)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={simulating}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px' }}
              >
                <Send size={15} />
                {simulating ? 'Injecting Simulated Order...' : 'Inject Simulated Master Order'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* MODAL: ADD / EDIT FOLLOWER */}
      {showFollowerModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingFollower ? 'Edit Follower' : 'Add Follower Account'}</h3>
              <button className="icon-btn" onClick={() => setShowFollowerModal(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveFollower} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Linked Broker Account</label>
                <select
                  className="filter-select"
                  value={followerForm.followerAccountId}
                  onChange={(e) => {
                    const selId = e.target.value;
                    if (selId === 'MOCK_FOLLOWER_01') {
                      setFollowerForm({
                        ...followerForm,
                        followerAccountId: 'MOCK_FOLLOWER_01',
                        followerBroker: 'MOCK',
                        followerName: 'Mock Follower'
                      });
                    } else {
                      const matched = brokerAccounts.find(a => String(a._id) === selId);
                      setFollowerForm({
                        ...followerForm,
                        followerAccountId: selId,
                        followerBroker: matched ? matched.broker : followerForm.followerBroker,
                        followerName: matched ? `${matched.broker} Follower` : followerForm.followerName
                      });
                    }
                  }}
                  style={{ width: '100%' }}
                  required
                >
                  <option value="" disabled>-- Select Connected Broker Account --</option>
                  {brokerAccounts
                    .filter(acc => String(acc._id) !== String(config?.masterAccountId))
                    .map((acc) => (
                      <option key={acc._id} value={acc._id}>
                        {acc.broker} ({acc.credentials?.clientId || String(acc._id).slice(-6)})
                      </option>
                    ))}
                  <option value="MOCK_FOLLOWER_01">MOCK (Local Simulation Account)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Follower Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={followerForm.followerName}
                  onChange={(e) => setFollowerForm({ ...followerForm, followerName: e.target.value })}
                  placeholder="e.g. Upstox Follower"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Broker</label>
                <input
                  type="text"
                  className="form-input"
                  value={followerForm.followerBroker}
                  disabled
                  style={{ opacity: 0.8, cursor: 'not-allowed' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Sizing Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    value={followerForm.multiplier}
                    onChange={(e) => setFollowerForm({ ...followerForm, multiplier: Number(e.target.value) })}
                    min="0.1"
                    max="10"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Max Order Qty</label>
                  <input
                    type="number"
                    className="form-input"
                    value={followerForm.maxOrderQuantity}
                    onChange={(e) => setFollowerForm({ ...followerForm, maxOrderQuantity: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowFollowerModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Follower
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EMERGENCY STOP CONFIRMATION */}
      {showEmergencyModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 450, borderColor: '#ef4444' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444', marginBottom: 12 }}>
              <ShieldAlert size={24} />
              <h3 style={{ margin: 0 }}>Confirm Emergency Stop</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              This will IMMEDIATELY halt all master order replication and reject all new copy operations across every follower account.
            </p>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Reason for Emergency Stop</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Market volatility / manual risk intervention"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowEmergencyModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                style={{ background: '#ef4444', borderColor: '#dc2626', color: '#fff' }}
                onClick={handleEmergencyStop}
              >
                Trigger Kill Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
