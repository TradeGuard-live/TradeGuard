import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, StatCard } from '../components/Card';
import {
  BookOpen, Plus, Trash2, Edit3, CheckCircle2,
  AlertTriangle, XCircle, X, Upload, Target, Brain, FileText, RefreshCw
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

// Standard TradeGuard Color palette & helpers
function formatINR(value) {
  const n = Number(value || 0);
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Preset Constants
const PRESET_EMOTIONS = [
  'Calm', 'Confident', 'Fearful', 'Anxious',
  'Greedy', 'Impatient', 'Overconfident', 'Distracted'
];

const STANDARD_MISTAKES = [
  'Revenge trading',
  'FOMO entry',
  'Overtrading',
  'Early exit',
  'Late exit',
  'Moving stop-loss',
  'Ignoring trading plan',
  'Excessive position size',
  'Entering without confirmation',
  'Trading outside planned hours'
];

const STANDARD_SETUPS = [
  'Breakout',
  'Pullback',
  'Support / Resistance',
  'Trend Following',
  'Mean Reversion',
  'Double Bottom / Top',
  'Opening Range Breakout (ORB)',
  'VWAP Reversal',
  'Scalping'
];

const MARKET_CONDITIONS = [
  'Trending Bullish',
  'Trending Bearish',
  'Rangebound / Sideways',
  'High Volatility',
  'Low Volatility'
];

export default function TradingJournal() {
  const location = useLocation();
  const toast = useToast();

  // Navigation Tabs: 'log' | 'editor' | 'strategies' | 'mistakes' | 'analytics'
  const [activeTab, setActiveTab] = useState('log');

  // Core Data States
  const [entries, setEntries] = useState([]);
  const [totalEntriesCount, setTotalEntriesCount] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [strategiesList, setStrategiesList] = useState([]);
  const [dbTrades, setDbTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [range, setRange] = useState('all');
  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [mistakeFilter, setMistakeFilter] = useState('all');
  const [emotionFilter, setEmotionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Selected Entry for Drawer / Detail View
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [imagePreviewModal, setImagePreviewModal] = useState(null);

  // Form State for Create / Edit
  const [editingId, setEditingId] = useState(null);
  const [formSource, setFormSource] = useState('standalone'); // 'linked' | 'standalone'
  const [selectedTradeRecordId, setSelectedTradeRecordId] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [customMistakeInput, setCustomMistakeInput] = useState('');
  const [customStrategyInput, setCustomStrategyInput] = useState('');

  const [formData, setFormData] = useState({
    symbol: '',
    instrument: '',
    segment: 'EQUITY',
    direction: 'BUY',
    status: 'PUBLISHED',
    entryTime: new Date().toISOString().slice(0, 16),
    exitTime: '',
    entryPrice: '',
    exitPrice: '',
    quantity: '1',
    grossPnl: '',
    netPnl: '',
    strategy: 'Breakout',
    setup: 'Breakout',
    marketConditions: 'Trending Bullish',
    entryReasoning: '',
    exitReasoning: '',
    stopLossReasoning: '',
    targetReasoning: '',
    lessonsLearned: '',
    personalNotes: '',
    preTrade: {
      whyEntering: '',
      setup: 'Breakout',
      confirmation: '',
      plannedStopLoss: '',
      plannedTarget: '',
      plannedRiskReward: '',
      confidenceLevel: 'MEDIUM',
      invalidationCriteria: ''
    },
    postTrade: {
      whyExited: '',
      followedPlan: true,
      wasEntryCorrect: true,
      wasExitCorrect: true,
      modifiedStopLoss: false,
      exitedEarly: false,
      mistakesSummary: '',
      lessonsLearned: '',
      improvements: ''
    },
    psychology: {
      preTradeEmotions: ['Calm'],
      postTradeEmotionalState: 'Satisfied',
      disciplineScore: 8,
      followedTradingPlan: true,
      revengeTrading: false,
      fomoEntry: false,
      overtrading: false,
      earlyExit: false,
      stopLossViolation: false
    },
    mistakes: [],
    attachments: []
  });

  // Load Entries and Analytics
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, analyticsRes, stratRes, tradesRes] = await Promise.all([
        api.listJournalEntries({
          range,
          segment: segmentFilter,
          strategy: strategyFilter,
          outcome: outcomeFilter,
          mistake: mistakeFilter,
          emotion: emotionFilter,
          status: statusFilter,
          symbol: search
        }),
        api.getJournalAnalytics(range).catch(() => null),
        api.getJournalStrategies().catch(() => null),
        api.listTrades().catch(() => null)
      ]);

      if (entriesRes?.success) {
        setEntries(entriesRes.data || []);
        setTotalEntriesCount(entriesRes.totalCount || entriesRes.count || 0);
      }
      if (analyticsRes?.success) {
        setAnalytics(analyticsRes.data);
      }
      if (stratRes?.success && Array.isArray(stratRes.data)) {
        setStrategiesList(stratRes.data);
      }
      if (tradesRes?.data && Array.isArray(tradesRes.data)) {
        setDbTrades(tradesRes.data);
      }
    } catch (err) {
      toast.push(err.message || 'Failed to load journal records', 'error');
    } finally {
      setLoading(false);
    }
  }, [range, segmentFilter, strategyFilter, outcomeFilter, mistakeFilter, emotionFilter, statusFilter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ✅ Auto prefill when navigated from Trades page with a selected trade
  useEffect(() => {
    if (location.state?.prefillTrade) {
      const t = location.state.prefillTrade;
      setFormSource('linked');
      setSelectedTradeRecordId(t._id || '');
      setEditingId(null);
      setFormData((prev) => ({
        ...prev,
        tradeRecordId: t._id,
        tradeId: t.tradeId || t.orderId || null,
        symbol: t.symbol || '',
        instrument: t.symbol || '',
        segment: t.segment || 'EQUITY',
        direction: t.transactionType || 'BUY',
        entryTime: t.tradeTime ? new Date(t.tradeTime).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
        entryPrice: t.executedPrice ?? t.averagePrice ?? t.price ?? '',
        quantity: t.quantity ?? '1',
        preTrade: {
          ...prev.preTrade,
          setup: 'Breakout'
        }
      }));
      setActiveTab('editor');
      toast.push(`Prefilled journal entry with trade ${t.symbol}`, 'info');
      // Clear location state
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Recalculate planned R:R whenever Entry Price, Planned SL, or Target change
  useEffect(() => {
    const ep = Number(formData.entryPrice);
    const sl = Number(formData.preTrade.plannedStopLoss);
    const tp = Number(formData.preTrade.plannedTarget);
    if (ep > 0 && sl > 0 && tp > 0) {
      const isBuy = formData.direction === 'BUY' || formData.direction === 'LONG';
      const risk = isBuy ? ep - sl : sl - ep;
      const reward = isBuy ? tp - ep : ep - tp;
      if (risk > 0 && reward > 0) {
        const rr = Math.round((reward / risk) * 100) / 100;
        if (formData.preTrade.plannedRiskReward !== rr) {
          setFormData((prev) => ({
            ...prev,
            preTrade: { ...prev.preTrade, plannedRiskReward: rr }
          }));
        }
      }
    }
  }, [formData.entryPrice, formData.direction, formData.preTrade.plannedStopLoss, formData.preTrade.plannedTarget, formData.preTrade.plannedRiskReward]);

  // Calculate Gross / Net P&L if entry & exit prices given
  useEffect(() => {
    const ep = Number(formData.entryPrice);
    const xp = Number(formData.exitPrice);
    const qty = Number(formData.quantity) || 1;
    if (ep > 0 && xp > 0 && qty > 0) {
      const isBuy = formData.direction === 'BUY' || formData.direction === 'LONG';
      const gross = Math.round((isBuy ? (xp - ep) * qty : (ep - xp) * qty) * 100) / 100;
      const approxCharges = Math.max(20, (ep * qty + xp * qty) * 0.0005);
      const net = Math.round((gross - approxCharges) * 100) / 100;
      if (formData.grossPnl !== gross || formData.netPnl !== net) {
        setFormData((prev) => ({
          ...prev,
          grossPnl: gross,
          netPnl: net
        }));
      }
    }
  }, [formData.entryPrice, formData.exitPrice, formData.quantity, formData.direction, formData.grossPnl, formData.netPnl]);

  // Handler for linking a TradeRecord from dropdown
  const handleSelectTradeRecord = (tradeRecordId) => {
    setSelectedTradeRecordId(tradeRecordId);
    if (!tradeRecordId) {
      setFormSource('standalone');
      return;
    }
    const t = dbTrades.find((item) => item._id === tradeRecordId);
    if (t) {
      setFormData((prev) => ({
        ...prev,
        tradeRecordId: t._id,
        tradeId: t.tradeId || t.orderId || null,
        symbol: t.symbol || '',
        instrument: t.symbol || '',
        segment: t.segment || 'EQUITY',
        direction: t.transactionType || 'BUY',
        entryTime: t.tradeTime ? new Date(t.tradeTime).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
        entryPrice: t.executedPrice ?? t.averagePrice ?? t.price ?? '',
        quantity: t.quantity ?? '1'
      }));
    }
  };

  // Toggle emotion in preTradeEmotions
  const toggleEmotion = (emo) => {
    setFormData((prev) => {
      const current = prev.psychology.preTradeEmotions || [];
      const next = current.includes(emo) ? current.filter((e) => e !== emo) : [...current, emo];
      return {
        ...prev,
        psychology: { ...prev.psychology, preTradeEmotions: next }
      };
    });
  };

  // Toggle mistake tag
  const toggleMistake = (m) => {
    setFormData((prev) => {
      const current = prev.mistakes || [];
      const next = current.includes(m) ? current.filter((item) => item !== m) : [...current, m];
      return { ...prev, mistakes: next };
    });
  };

  const handleAddCustomMistake = () => {
    const val = customMistakeInput.trim();
    if (!val) return;
    if (!formData.mistakes.includes(val)) {
      setFormData((prev) => ({ ...prev, mistakes: [...prev.mistakes, val] }));
    }
    setCustomMistakeInput('');
  };

  const handleAddCustomStrategy = () => {
    const val = customStrategyInput.trim();
    if (!val) return;
    if (!strategiesList.includes(val)) {
      setStrategiesList((prev) => [...prev, val]);
    }
    setFormData((prev) => ({ ...prev, strategy: val }));
    setCustomStrategyInput('');
  };

  // Upload Attachment
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    // Validate size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.push('Attachment size exceeds 5MB limit', 'warning');
      return;
    }

    setUploadingAttachment(true);
    try {
      const res = await api.uploadJournalAttachment(file);
      if (res?.success && res.data) {
        const att = {
          url: res.data.url,
          filename: res.data.filename,
          originalName: res.data.originalName,
          mimeType: res.data.mimeType,
          size: res.data.size,
          caption: file.name,
          attachmentType: 'ENTRY_CHART'
        };
        setFormData((prev) => ({
          ...prev,
          attachments: [...prev.attachments, att]
        }));
        toast.push('Attachment uploaded successfully', 'success');
      }
    } catch (err) {
      toast.push(err.message || 'Failed to upload attachment', 'error');
    } finally {
      setUploadingAttachment(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (index) => {
    setFormData((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index)
    }));
  };

  // Reset form
  const resetForm = () => {
    setEditingId(null);
    setFormSource('standalone');
    setSelectedTradeRecordId('');
    setFormData({
      symbol: '',
      instrument: '',
      segment: 'EQUITY',
      direction: 'BUY',
      status: 'PUBLISHED',
      entryTime: new Date().toISOString().slice(0, 16),
      exitTime: '',
      entryPrice: '',
      exitPrice: '',
      quantity: '1',
      grossPnl: '',
      netPnl: '',
      strategy: 'Breakout',
      setup: 'Breakout',
      marketConditions: 'Trending Bullish',
      entryReasoning: '',
      exitReasoning: '',
      stopLossReasoning: '',
      targetReasoning: '',
      lessonsLearned: '',
      personalNotes: '',
      preTrade: {
        whyEntering: '',
        setup: 'Breakout',
        confirmation: '',
        plannedStopLoss: '',
        plannedTarget: '',
        plannedRiskReward: '',
        confidenceLevel: 'MEDIUM',
        invalidationCriteria: ''
      },
      postTrade: {
        whyExited: '',
        followedPlan: true,
        wasEntryCorrect: true,
        wasExitCorrect: true,
        modifiedStopLoss: false,
        exitedEarly: false,
        mistakesSummary: '',
        lessonsLearned: '',
        improvements: ''
      },
      psychology: {
        preTradeEmotions: ['Calm'],
        postTradeEmotionalState: 'Satisfied',
        disciplineScore: 8,
        followedTradingPlan: true,
        revengeTrading: false,
        fomoEntry: false,
        overtrading: false,
        earlyExit: false,
        stopLossViolation: false
      },
      mistakes: [],
      attachments: []
    });
  };

  // Edit existing entry
  const startEditEntry = (entry) => {
    setEditingId(entry._id);
    setFormSource(entry.tradeRecordId ? 'linked' : 'standalone');
    setSelectedTradeRecordId(entry.tradeRecordId?._id || entry.tradeRecordId || '');
    setFormData({
      tradeRecordId: entry.tradeRecordId?._id || entry.tradeRecordId || null,
      tradeId: entry.tradeId || null,
      symbol: entry.symbol || '',
      instrument: entry.instrument || entry.symbol || '',
      segment: entry.segment || 'EQUITY',
      direction: entry.direction || 'BUY',
      status: entry.status || 'PUBLISHED',
      entryTime: entry.entryTime ? new Date(entry.entryTime).toISOString().slice(0, 16) : '',
      exitTime: entry.exitTime ? new Date(entry.exitTime).toISOString().slice(0, 16) : '',
      entryPrice: entry.entryPrice ?? '',
      exitPrice: entry.exitPrice ?? '',
      quantity: entry.quantity ?? '1',
      grossPnl: entry.grossPnl ?? '',
      netPnl: entry.netPnl ?? '',
      strategy: entry.strategy || 'Discretionary',
      setup: entry.setup || '',
      marketConditions: entry.marketConditions || 'Trending Bullish',
      entryReasoning: entry.entryReasoning || '',
      exitReasoning: entry.exitReasoning || '',
      stopLossReasoning: entry.stopLossReasoning || '',
      targetReasoning: entry.targetReasoning || '',
      lessonsLearned: entry.lessonsLearned || '',
      personalNotes: entry.personalNotes || '',
      preTrade: {
        whyEntering: entry.preTrade?.whyEntering || '',
        setup: entry.preTrade?.setup || '',
        confirmation: entry.preTrade?.confirmation || '',
        plannedStopLoss: entry.preTrade?.plannedStopLoss ?? '',
        plannedTarget: entry.preTrade?.plannedTarget ?? '',
        plannedRiskReward: entry.preTrade?.plannedRiskReward ?? '',
        confidenceLevel: entry.preTrade?.confidenceLevel || 'MEDIUM',
        invalidationCriteria: entry.preTrade?.invalidationCriteria || ''
      },
      postTrade: {
        whyExited: entry.postTrade?.whyExited || '',
        followedPlan: entry.postTrade?.followedPlan ?? true,
        wasEntryCorrect: entry.postTrade?.wasEntryCorrect ?? true,
        wasExitCorrect: entry.postTrade?.wasExitCorrect ?? true,
        modifiedStopLoss: entry.postTrade?.modifiedStopLoss ?? false,
        exitedEarly: entry.postTrade?.exitedEarly ?? false,
        mistakesSummary: entry.postTrade?.mistakesSummary || '',
        lessonsLearned: entry.postTrade?.lessonsLearned || '',
        improvements: entry.postTrade?.improvements || ''
      },
      psychology: {
        preTradeEmotions: entry.psychology?.preTradeEmotions || [],
        postTradeEmotionalState: entry.psychology?.postTradeEmotionalState || '',
        disciplineScore: entry.psychology?.disciplineScore ?? 8,
        followedTradingPlan: entry.psychology?.followedTradingPlan ?? true,
        revengeTrading: entry.psychology?.revengeTrading ?? false,
        fomoEntry: entry.psychology?.fomoEntry ?? false,
        overtrading: entry.psychology?.overtrading ?? false,
        earlyExit: entry.psychology?.earlyExit ?? false,
        stopLossViolation: entry.psychology?.stopLossViolation ?? false
      },
      mistakes: entry.mistakes || [],
      attachments: entry.attachments || []
    });
    setSelectedEntry(null);
    setActiveTab('editor');
  };

  // Submit Handler (Create or Update, Draft or Published)
  const handleSubmit = async (publishStatus = 'PUBLISHED') => {
    if (!formData.symbol.trim()) {
      toast.push('Trading symbol is required', 'warning');
      return;
    }

    const payload = {
      ...formData,
      status: publishStatus,
      entryPrice: formData.entryPrice !== '' ? Number(formData.entryPrice) : 0,
      exitPrice: formData.exitPrice !== '' ? Number(formData.exitPrice) : null,
      quantity: formData.quantity !== '' ? Number(formData.quantity) : 1,
      grossPnl: formData.grossPnl !== '' ? Number(formData.grossPnl) : null,
      netPnl: formData.netPnl !== '' ? Number(formData.netPnl) : null,
      preTrade: {
        ...formData.preTrade,
        plannedStopLoss: formData.preTrade.plannedStopLoss !== '' ? Number(formData.preTrade.plannedStopLoss) : null,
        plannedTarget: formData.preTrade.plannedTarget !== '' ? Number(formData.preTrade.plannedTarget) : null,
        plannedRiskReward: formData.preTrade.plannedRiskReward !== '' ? Number(formData.preTrade.plannedRiskReward) : null
      },
      psychology: {
        ...formData.psychology,
        disciplineScore: Number(formData.psychology.disciplineScore) || 8
      }
    };

    try {
      if (editingId) {
        await api.updateJournalEntry(editingId, payload);
        toast.push('Journal entry updated successfully', 'success');
      } else {
        await api.createJournalEntry(payload);
        toast.push(publishStatus === 'DRAFT' ? 'Journal draft saved' : 'Journal entry published', 'success');
      }
      resetForm();
      setActiveTab('log');
      loadData();
    } catch (err) {
      toast.push(err.message || 'Failed to save journal entry', 'error');
    }
  };

  // Delete Handler
  const handleDelete = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this journal entry?')) return;
    try {
      await api.deleteJournalEntry(id);
      toast.push('Journal entry deleted', 'success');
      if (selectedEntry?._id === id) setSelectedEntry(null);
      loadData();
    } catch (err) {
      toast.push(err.message || 'Failed to delete journal entry', 'error');
    }
  };

  // Top stats derived
  const disciplineScore = analytics?.disciplineScore ?? 8.0;
  const planAdherence = analytics?.planAdherencePercent ?? 100;
  const netPnl = analytics?.totalNetPnl ?? 0;
  const winRate = analytics?.winRate ?? 0;

  return (
    <>
      {/* Header section */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">Trading Journal</h1>
          <p className="page-description">
            Pre-trade checklists, post-trade analysis, emotional discipline tracking &amp; strategy performance.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={loadData}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loading ? 'spinner-rotate' : ''} />
            <span>Refresh</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              resetForm();
              setActiveTab('editor');
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} />
            <span>New Journal Entry</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Trading Discipline Score"
          value={`${disciplineScore} / 10`}
          change={disciplineScore >= 7 ? 'Strong mental control' : 'Review emotional triggers'}
          changeType={disciplineScore >= 7 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Plan Adherence Rate"
          value={`${planAdherence}%`}
          change="Followed trading plan"
          changeType={planAdherence >= 75 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Strategy Win Rate"
          value={`${winRate}%`}
          change={`${analytics?.totalEntries || 0} journaled trades`}
          changeType="neutral"
        />
        <StatCard
          label="Journaled Net P&amp;L"
          value={formatINR(netPnl)}
          change={netPnl >= 0 ? 'Profitable overall' : 'Net drawdown'}
          changeType={netPnl >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Top Navigation Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => setActiveTab('log')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <BookOpen size={15} />
          <span>Journal Log ({totalEntriesCount})</span>
        </button>
        <button
          className={`tab ${activeTab === 'editor' ? 'active' : ''}`}
          onClick={() => setActiveTab('editor')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Edit3 size={15} />
          <span>{editingId ? 'Edit Entry' : 'New Entry / Review'}</span>
        </button>
        <button
          className={`tab ${activeTab === 'strategies' ? 'active' : ''}`}
          onClick={() => setActiveTab('strategies')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Target size={15} />
          <span>Strategy Performance</span>
        </button>
        <button
          className={`tab ${activeTab === 'mistakes' ? 'active' : ''}`}
          onClick={() => setActiveTab('mistakes')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <AlertTriangle size={15} />
          <span>Mistake Tracker</span>
        </button>
        <button
          className={`tab ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Brain size={15} />
          <span>Psychology &amp; Reviews</span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: JOURNAL LOG & HISTORY                             */}
      {/* ========================================================= */}
      {activeTab === 'log' && (
        <Card padded={false}>
          <div style={{ padding: 20 }}>
            <div className="card-title">All Journal Entries</div>
            <div className="card-subtitle">
              Browse, filter, and inspect your recorded trade reviews and psychology logs.
            </div>

            {/* Filter Bar */}
            <div className="filters-row" style={{ marginTop: 16 }}>
              <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                <input
                  className="form-input"
                  style={{ width: '100%' }}
                  placeholder="Search symbol, notes, or strategy…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className="filter-select"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="1y">Last 1 year</option>
              </select>

              <select
                className="filter-select"
                value={segmentFilter}
                onChange={(e) => setSegmentFilter(e.target.value)}
              >
                <option value="all">All Segments</option>
                <option value="EQUITY">Equity</option>
                <option value="FUTURES">Futures</option>
                <option value="OPTIONS">Options</option>
              </select>

              <select
                className="filter-select"
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
              >
                <option value="all">All Strategies</option>
                {strategiesList.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <select
                className="filter-select"
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
              >
                <option value="all">All Outcomes</option>
                <option value="WIN">Winning Trades</option>
                <option value="LOSS">Losing Trades</option>
                <option value="BREAKEVEN">Breakeven</option>
              </select>

              <select
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Drafts</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Direction</th>
                  <th>Strategy</th>
                  <th className="text-right">Entry / Exit</th>
                  <th className="text-right">Net P&amp;L</th>
                  <th>Plan</th>
                  <th>Discipline</th>
                  <th>Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      Loading journal entries…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 50 }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
                        No journal entries match your selected criteria.
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          resetForm();
                          setActiveTab('editor');
                        }}
                      >
                        Create First Journal Entry
                      </button>
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => {
                    const isWin = (entry.netPnl || 0) > 0;
                    const isLoss = (entry.netPnl || 0) < 0;
                    const followed = entry.postTrade?.followedPlan ?? entry.psychology?.followedTradingPlan ?? true;

                    return (
                      <tr
                        key={entry._id}
                        onClick={() => setSelectedEntry(entry)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div className="text-primary">{formatDate(entry.entryTime || entry.createdAt)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {formatTime(entry.entryTime || entry.createdAt)}
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.symbol}</span>
                            {entry.attachments?.length > 0 && (
                              <span
                                title={`${entry.attachments.length} attachment(s)`}
                                style={{
                                  fontSize: 10,
                                  background: 'rgba(59, 130, 246, 0.15)',
                                  color: '#60a5fa',
                                  padding: '1px 5px',
                                  borderRadius: 4
                                }}
                              >
                                📎 {entry.attachments.length}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {entry.segment} · Qty: {entry.quantity || 1}
                          </div>
                        </td>

                        <td>
                          <span className={`badge ${entry.direction === 'BUY' || entry.direction === 'LONG' ? 'badge-success' : 'badge-danger'}`}>
                            {entry.direction}
                          </span>
                        </td>

                        <td>
                          <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                            {entry.strategy || 'Discretionary'}
                          </span>
                          {entry.setup && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {entry.setup}
                            </div>
                          )}
                        </td>

                        <td className="text-right mono">
                          <div>₹{Number(entry.entryPrice || 0).toLocaleString('en-IN')}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {entry.exitPrice ? `Exit: ₹${Number(entry.exitPrice).toLocaleString('en-IN')}` : 'Open / Unset'}
                          </div>
                        </td>

                        <td className="text-right mono">
                          {entry.netPnl != null ? (
                            <span style={{ color: isWin ? 'var(--success)' : isLoss ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                              {formatINR(entry.netPnl)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        <td>
                          <span
                            className="badge"
                            style={{
                              fontSize: 11,
                              background: followed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                              color: followed ? '#10b981' : '#ef4444',
                              border: `1px solid ${followed ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`
                            }}
                          >
                            {followed ? 'Followed' : 'Broke Plan'}
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="mono" style={{ fontWeight: 600 }}>
                              {entry.psychology?.disciplineScore ?? 8}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ 10</span>
                          </div>
                        </td>

                        <td>
                          <span className={`badge ${entry.status === 'DRAFT' ? 'badge-warning' : 'badge-neutral'}`} style={{ fontSize: 11 }}>
                            {entry.status}
                          </span>
                        </td>

                        <td className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                            <button
                              className="icon-btn"
                              title="Edit Journal Entry"
                              onClick={() => startEditEntry(entry)}
                              style={{ padding: 4 }}
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Delete Journal Entry"
                              onClick={(e) => handleDelete(entry._id, e)}
                              style={{ padding: 4, color: 'var(--danger)' }}
                            >
                              <Trash2 size={14} />
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
        </Card>
      )}

      {/* ========================================================= */}
      {/* TAB 2: JOURNAL ENTRY EDITOR (PRE & POST TRADE)           */}
      {/* ========================================================= */}
      {activeTab === 'editor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top Form Mode Selector */}
          <Card
            title={editingId ? 'Edit Trading Journal Entry' : 'New Trading Journal Entry'}
            subtitle="Record comprehensive pre-trade hypotheses, execution telemetry, and psychological reflections."
          >
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${formSource === 'standalone' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFormSource('standalone')}
                style={{ fontSize: 13 }}
              >
                Standalone Entry
              </button>
              <button
                type="button"
                className={`btn ${formSource === 'linked' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFormSource('linked')}
                style={{ fontSize: 13 }}
              >
                Link to Executed Broker Trade
              </button>
            </div>

            {formSource === 'linked' && (
              <div style={{ marginBottom: 20, padding: 14, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <label className="form-label">Select Saved Broker Trade Execution</label>
                <select
                  className="form-select"
                  value={selectedTradeRecordId}
                  onChange={(e) => handleSelectTradeRecord(e.target.value)}
                >
                  <option value="">-- Choose from your database trade executions --</option>
                  {dbTrades.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.symbol} ({t.transactionType} {t.quantity} @ ₹{t.executedPrice}) - {t.broker} ({formatDate(t.tradeTime)})
                    </option>
                  ))}
                </select>
                <div className="form-hint">
                  Selecting an execution auto-fills symbol, quantity, side, price, and segment from your synced broker trade book.
                </div>
              </div>
            )}

            {/* Core Instrument & Order telemetry */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Trading Symbol *</label>
                <input
                  className="form-input"
                  placeholder="e.g. RELIANCE, NIFTY24DEC24000CE"
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Trade Direction *</label>
                <select
                  className="form-select"
                  value={formData.direction}
                  onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
                >
                  <option value="BUY">BUY / LONG</option>
                  <option value="SELL">SELL / SHORT</option>
                </select>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <div className="form-group">
                <label className="form-label">Trading Segment</label>
                <select
                  className="form-select"
                  value={formData.segment}
                  onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
                >
                  <option value="EQUITY">Equity (Cash / CNC / MIS)</option>
                  <option value="FUTURES">Futures</option>
                  <option value="OPTIONS">Options</option>
                  <option value="COMMODITY">Commodity</option>
                  <option value="CURRENCY">Currency</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Trading Strategy</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="form-select"
                    value={formData.strategy}
                    onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
                    style={{ flex: 1 }}
                  >
                    {strategiesList.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    placeholder="New strategy"
                    value={customStrategyInput}
                    onChange={(e) => setCustomStrategyInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomStrategy(); } }}
                    style={{ width: 140 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleAddCustomStrategy}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <div className="form-group">
                <label className="form-label">Trade Setup</label>
                <select
                  className="form-select"
                  value={formData.setup}
                  onChange={(e) => setFormData({ ...formData, setup: e.target.value })}
                >
                  {STANDARD_SETUPS.map((setup) => (
                    <option key={setup} value={setup}>{setup}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Market Conditions</label>
                <select
                  className="form-select"
                  value={formData.marketConditions}
                  onChange={(e) => setFormData({ ...formData, marketConditions: e.target.value })}
                >
                  {MARKET_CONDITIONS.map((cond) => (
                    <option key={cond} value={cond}>{cond}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <div className="form-group">
                <label className="form-label">Entry Price (₹)</label>
                <input
                  type="number"
                  step="any"
                  className="form-input mono"
                  placeholder="e.g. 2500"
                  value={formData.entryPrice}
                  onChange={(e) => setFormData({ ...formData, entryPrice: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Exit Price (₹)</label>
                <input
                  type="number"
                  step="any"
                  className="form-input mono"
                  placeholder="e.g. 2560 (leave blank if trade is still open)"
                  value={formData.exitPrice}
                  onChange={(e) => setFormData({ ...formData, exitPrice: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  className="form-input mono"
                  placeholder="e.g. 10"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Net Realized P&amp;L (₹)</label>
                <input
                  type="number"
                  step="any"
                  className="form-input mono"
                  placeholder="Auto-calculated from entry/exit prices"
                  value={formData.netPnl}
                  onChange={(e) => setFormData({ ...formData, netPnl: e.target.value })}
                />
              </div>
            </div>
          </Card>

          {/* SECTION 4: PRE-TRADE REVIEW */}
          <Card
            title="Pre-Trade Review (Section 4)"
            subtitle="Complete these structured questions BEFORE executing or right as you enter the trade."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">1. Why am I entering?</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Core catalyst or thesis behind taking this position…"
                  value={formData.preTrade.whyEntering}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, whyEntering: e.target.value }
                  })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">2. What confirms the entry?</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Trigger indicators: volume surge, candle close, RSI divergence…"
                  value={formData.preTrade.confirmation}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, confirmation: e.target.value }
                  })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">3. Planned Stop-Loss (₹)</label>
                <input
                  type="number"
                  step="any"
                  className="form-input mono"
                  placeholder="e.g. 2480"
                  value={formData.preTrade.plannedStopLoss}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, plannedStopLoss: e.target.value }
                  })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">4. Target Price (₹)</label>
                <input
                  type="number"
                  step="any"
                  className="form-input mono"
                  placeholder="e.g. 2560"
                  value={formData.preTrade.plannedTarget}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, plannedTarget: e.target.value }
                  })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">5. Planned Risk / Reward (R:R)</label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input mono"
                  placeholder="Auto-calculated from SL & Target"
                  value={formData.preTrade.plannedRiskReward}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, plannedRiskReward: e.target.value }
                  })}
                />
                <div className="form-hint">
                  Target / Stop-loss ratio: {formData.preTrade.plannedRiskReward ? `1 : ${formData.preTrade.plannedRiskReward}` : 'Enter SL and Target'}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">6. Confidence Level</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {['LOW', 'MEDIUM', 'HIGH'].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`btn ${formData.preTrade.confidenceLevel === lvl ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      style={{ flex: 1 }}
                      onClick={() => setFormData({
                        ...formData,
                        preTrade: { ...formData.preTrade, confidenceLevel: lvl }
                      })}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">7. What would invalidate this trade?</label>
                <input
                  className="form-input"
                  placeholder="Specific market condition or price action that proves this trade wrong…"
                  value={formData.preTrade.invalidationCriteria}
                  onChange={(e) => setFormData({
                    ...formData,
                    preTrade: { ...formData.preTrade, invalidationCriteria: e.target.value }
                  })}
                />
              </div>
            </div>
          </Card>

          {/* SECTION 4: POST-TRADE REVIEW */}
          <Card
            title="Post-Trade Review (Section 4)"
            subtitle="Evaluate execution fidelity and lessons learned after exiting."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">1. Why did I exit?</label>
                <input
                  className="form-input"
                  placeholder="Hit target, stopped out, end of session, or trailing SL triggered…"
                  value={formData.postTrade.whyExited}
                  onChange={(e) => setFormData({
                    ...formData,
                    postTrade: { ...formData.postTrade, whyExited: e.target.value }
                  })}
                />
              </div>

              {/* Boolean questions */}
              {[
                { key: 'followedPlan', label: '2. Did I follow my trading plan?' },
                { key: 'wasEntryCorrect', label: '3. Was my entry timing correct?' },
                { key: 'wasExitCorrect', label: '4. Was my exit execution correct?' },
                { key: 'modifiedStopLoss', label: '5. Did I modify or widen my stop-loss?' },
                { key: 'exitedEarly', label: '6. Did I exit prematurely out of fear?' },
              ].map(({ key, label }) => (
                <div key={key} style={{ padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>{label}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className={`btn ${formData.postTrade[key] === true ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      style={{ flex: 1 }}
                      onClick={() => setFormData({
                        ...formData,
                        postTrade: { ...formData.postTrade, [key]: true }
                      })}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={`btn ${formData.postTrade[key] === false ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      style={{ flex: 1 }}
                      onClick={() => setFormData({
                        ...formData,
                        postTrade: { ...formData.postTrade, [key]: false }
                      })}
                    >
                      No
                    </button>
                  </div>
                </div>
              ))}

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">7. What did I learn from this trade?</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Key takeaway or behavioral insight…"
                  value={formData.postTrade.lessonsLearned}
                  onChange={(e) => setFormData({
                    ...formData,
                    postTrade: { ...formData.postTrade, lessonsLearned: e.target.value }
                  })}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">8. What will I improve next time?</label>
                <input
                  className="form-input"
                  placeholder="Actionable refinement for future setups…"
                  value={formData.postTrade.improvements}
                  onChange={(e) => setFormData({
                    ...formData,
                    postTrade: { ...formData.postTrade, improvements: e.target.value }
                  })}
                />
              </div>
            </div>
          </Card>

          {/* SECTION 5: TRADING PSYCHOLOGY TRACKER */}
          <Card
            title="Trading Psychology &amp; Discipline Tracker (Section 5)"
            subtitle="Track subjective emotional states without automatic inference."
          >
            {/* Pre-trade emotion pills */}
            <div style={{ marginBottom: 20 }}>
              <label className="form-label">Emotions Before the Trade</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {PRESET_EMOTIONS.map((emo) => {
                  const isSelected = formData.psychology.preTradeEmotions?.includes(emo);
                  return (
                    <button
                      key={emo}
                      type="button"
                      onClick={() => toggleEmotion(emo)}
                      className="badge"
                      style={{
                        padding: '6px 14px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.05)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)'
                      }}
                    >
                      {emo} {isSelected && '✓'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Post-Trade Emotional State</label>
                <select
                  className="form-select"
                  value={formData.psychology.postTradeEmotionalState}
                  onChange={(e) => setFormData({
                    ...formData,
                    psychology: { ...formData.psychology, postTradeEmotionalState: e.target.value }
                  })}
                >
                  <option value="Calm">Calm &amp; Grounded</option>
                  <option value="Satisfied">Satisfied / Content</option>
                  <option value="Frustrated">Frustrated</option>
                  <option value="Regretful">Regretful</option>
                  <option value="Angry">Angry</option>
                  <option value="Euphoric">Euphoric / Overexcited</option>
                  <option value="Anxious">Anxious / Stressed</option>
                  <option value="Distracted">Distracted</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Discipline Score: <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{formData.psychology.disciplineScore} / 10</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={formData.psychology.disciplineScore}
                  onChange={(e) => setFormData({
                    ...formData,
                    psychology: { ...formData.psychology, disciplineScore: Number(e.target.value) }
                  })}
                  style={{ width: '100%', marginTop: 8 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>1 (Zero discipline)</span>
                  <span>5 (Average)</span>
                  <span>10 (Flawless discipline)</span>
                </div>
              </div>
            </div>

            {/* Self-audit psychological checkboxes */}
            <div style={{ marginTop: 16 }}>
              <label className="form-label">Discipline &amp; Bias Flags</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 6 }}>
                {[
                  { key: 'revengeTrading', label: 'Revenge trading' },
                  { key: 'fomoEntry', label: 'FOMO entry' },
                  { key: 'overtrading', label: 'Overtrading' },
                  { key: 'earlyExit', label: 'Early exit out of anxiety' },
                  { key: 'stopLossViolation', label: 'Stop-loss violation' }
                ].map(({ key, label }) => {
                  const checked = Boolean(formData.psychology[key]);
                  return (
                    <label
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        background: checked ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${checked ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontSize: 12
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setFormData({
                          ...formData,
                          psychology: { ...formData.psychology, [key]: e.target.checked }
                        })}
                      />
                      <span style={{ color: checked ? '#f87171' : 'var(--text-secondary)' }}>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* SECTION 7: MISTAKE TRACKER TAGS */}
          <Card
            title="Trading Mistake Tags (Section 7)"
            subtitle="Categorize specific execution errors to identify systemic behavioral leaks."
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {STANDARD_MISTAKES.map((m) => {
                const isTagged = formData.mistakes.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMistake(m)}
                    className="badge"
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: isTagged ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: isTagged ? '#f87171' : 'var(--text-muted)',
                      border: isTagged ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border)'
                    }}
                  >
                    {isTagged ? '✖ ' : '+ '} {m}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, maxWidth: 450 }}>
              <input
                className="form-input"
                placeholder="Custom mistake (e.g. Traded before GDP release)…"
                value={customMistakeInput}
                onChange={(e) => setCustomMistakeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomMistake(); } }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAddCustomMistake}
              >
                Add Mistake
              </button>
            </div>
          </Card>

          {/* SECTION 9: SCREENSHOTS & ATTACHMENTS */}
          <Card
            title="Screenshots &amp; Chart Attachments (Section 9)"
            subtitle="Attach entry charts, exit charts, trade setups, and supporting documents (Max 5MB per file)."
          >
            <div style={{ marginBottom: 16 }}>
              <label
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: uploadingAttachment ? 'wait' : 'pointer'
                }}
              >
                <Upload size={15} />
                <span>{uploadingAttachment ? 'Uploading attachment…' : 'Upload Screenshot / Document'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  onChange={handleFileUpload}
                  disabled={uploadingAttachment}
                  style={{ display: 'none' }}
                />
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>
                Supports PNG, JPG, WEBP, and PDF
              </span>
            </div>

            {formData.attachments?.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: 'rgba(255, 255, 255, 0.01)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 13 }}>
                No attachments uploaded yet. Adding entry and exit chart screenshots improves post-trade reviews.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                {formData.attachments.map((att, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 10,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      position: 'relative'
                    }}
                  >
                    {att.mimeType?.startsWith('image/') ? (
                      <img
                        src={att.url}
                        alt={att.caption || 'Trade Screenshot'}
                        style={{
                          width: '100%',
                          height: 120,
                          objectFit: 'cover',
                          borderRadius: 6,
                          cursor: 'pointer'
                        }}
                        onClick={() => setImagePreviewModal(att.url)}
                      />
                    ) : (
                      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 6 }}>
                        <FileText size={36} color="var(--accent)" />
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      <select
                        className="form-select"
                        style={{ fontSize: 11, padding: '4px 8px', marginBottom: 6 }}
                        value={att.attachmentType}
                        onChange={(e) => {
                          const updated = [...formData.attachments];
                          updated[idx].attachmentType = e.target.value;
                          setFormData({ ...formData, attachments: updated });
                        }}
                      >
                        <option value="ENTRY_CHART">Entry Chart</option>
                        <option value="EXIT_CHART">Exit Chart</option>
                        <option value="SETUP">Trade Setup</option>
                        <option value="DOCUMENT">Document</option>
                      </select>

                      <input
                        className="form-input"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        placeholder="Caption / notes…"
                        value={att.caption || ''}
                        onChange={(e) => {
                          const updated = [...formData.attachments];
                          updated[idx].caption = e.target.value;
                          setFormData({ ...formData, attachments: updated });
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      title="Remove attachment"
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        background: 'rgba(0, 0, 0, 0.65)',
                        color: '#f87171',
                        borderRadius: '50%',
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Form Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingBottom: 40 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                resetForm();
                setActiveTab('log');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleSubmit('DRAFT')}
            >
              Save as Draft
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSubmit('PUBLISHED')}
              style={{ fontWeight: 600 }}
            >
              {editingId ? 'Update & Publish Entry' : 'Publish Journal Entry'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: STRATEGY PERFORMANCE                              */}
      {/* ========================================================= */}
      {activeTab === 'strategies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card
            title="Trading Strategy Breakdown"
            subtitle="Empirical performance analytics per trading strategy calculated directly from your journaled executions."
          >
            {(!analytics?.strategies || analytics.strategies.length === 0) ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No strategy performance data recorded yet. Tag your journal entries with strategies to see deep metrics.
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Win / Loss</th>
                      <th className="text-right">Win Rate</th>
                      <th className="text-right">Net P&amp;L</th>
                      <th className="text-right">Avg Win</th>
                      <th className="text-right">Avg Loss</th>
                      <th className="text-right">Profit Factor</th>
                      <th className="text-right">Avg Planned R:R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.strategies.map((st) => (
                      <tr key={st.strategy}>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{st.strategy}</span>
                        </td>
                        <td className="text-right mono">{st.trades}</td>
                        <td className="text-right mono">
                          <span style={{ color: 'var(--success)' }}>{st.wins}W</span> / <span style={{ color: 'var(--danger)' }}>{st.losses}L</span>
                        </td>
                        <td className="text-right mono">
                          <span style={{ color: st.winRate >= 50 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
                            {st.winRate}%
                          </span>
                        </td>
                        <td className="text-right mono">
                          <span style={{ color: st.netPnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                            {formatINR(st.netPnl)}
                          </span>
                        </td>
                        <td className="text-right mono" style={{ color: 'var(--success)' }}>
                          {formatINR(st.avgProfit)}
                        </td>
                        <td className="text-right mono" style={{ color: 'var(--danger)' }}>
                          {formatINR(st.avgLoss)}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 600 }}>
                          {st.profitFactor}
                        </td>
                        <td className="text-right mono">
                          {st.avgRiskReward ? `1 : ${st.avgRiskReward}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: MISTAKE TRACKER                                   */}
      {/* ========================================================= */}
      {activeTab === 'mistakes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card
            title="Trading Mistakes &amp; Behavioral Leaks"
            subtitle="Quantified analysis of execution mistakes, frequency of occurrence, and financial damage."
          >
            {(!analytics?.mistakes || analytics.mistakes.length === 0) ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No mistakes tracked yet. Great discipline! As you tag trading mistakes, their frequency and financial impact will be charted here.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                {analytics.mistakes.map((m) => (
                  <div
                    key={m.mistake}
                    style={{
                      padding: 16,
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>{m.mistake}</span>
                      <span className="badge badge-danger" style={{ fontSize: 11 }}>
                        {m.count} occurrence{m.count > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Financial Impact</div>
                        <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)', marginTop: 2 }}>
                          -{formatINR(m.financialLoss)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net Trade P&amp;L</div>
                        <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: m.netPnl >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 2 }}>
                          {formatINR(m.netPnl)}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
                      Occurred on {m.losingTrades} losing trades and {m.winningTrades} winning trades.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: PSYCHOLOGY & PERIODIC REVIEWS                     */}
      {/* ========================================================= */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Plan Adherence Impact Comparison */}
          <Card
            title="Plan Adherence Impact"
            subtitle="Direct empirical comparison of trading outcomes when following versus breaking your plan."
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, background: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={18} color="var(--success)" />
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>When Following Plan</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trades</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{analytics?.followedPlanStats?.count || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Win Rate</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>
                      {analytics?.followedPlanStats?.winRate || 0}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net P&amp;L</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: (analytics?.followedPlanStats?.netPnl || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatINR(analytics?.followedPlanStats?.netPnl)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.05)', borderRadius: 'var(--radius)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <XCircle size={18} color="var(--danger)" />
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>When Breaking Plan</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trades</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{analytics?.brokePlanStats?.count || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Win Rate</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)' }}>
                      {analytics?.brokePlanStats?.winRate || 0}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net P&amp;L</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: (analytics?.brokePlanStats?.netPnl || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatINR(analytics?.brokePlanStats?.netPnl)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Pre-Trade Emotion Performance */}
          <Card
            title="Pre-Trade Emotional State vs. Performance"
            subtitle="How your mindset prior to entering positions correlates with your financial results."
          >
            {(!analytics?.emotions || analytics.emotions.length === 0) ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
                No emotion data logged. Select pre-trade emotions when journaling to unlock psychological insights.
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Pre-Trade Emotion</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Win Rate</th>
                      <th className="text-right">Net P&amp;L</th>
                      <th className="text-right">Avg Discipline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.emotions.map((emo) => (
                      <tr key={emo.emotion}>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emo.emotion}</span>
                        </td>
                        <td className="text-right mono">{emo.trades}</td>
                        <td className="text-right mono">
                          <span style={{ color: emo.winRate >= 50 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                            {emo.winRate}%
                          </span>
                        </td>
                        <td className="text-right mono">
                          <span style={{ color: emo.netPnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                            {formatINR(emo.netPnl)}
                          </span>
                        </td>
                        <td className="text-right mono">
                          {emo.avgDiscipline} / 10
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Periodic Reviews (Weekly, Monthly, Yearly) */}
          <Card
            title="Periodic Reviews (Weekly, Monthly, Yearly)"
            subtitle="Historical timeline summaries aggregated across trade reviews."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Monthly breakdown */}
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  Monthly Review Timeline
                </h3>
                {(!analytics?.reviews?.monthly || analytics.reviews.monthly.length === 0) ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>
                    No monthly reviews available yet.
                  </div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="text-right">Trades</th>
                          <th className="text-right">Wins / Losses</th>
                          <th className="text-right">Win Rate</th>
                          <th className="text-right">Net P&amp;L</th>
                          <th className="text-right">Avg Discipline</th>
                          <th className="text-right">Plan Adherence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.reviews.monthly.map((rev) => (
                          <tr key={rev.period}>
                            <td style={{ fontWeight: 600 }}>{rev.label}</td>
                            <td className="text-right mono">{rev.trades}</td>
                            <td className="text-right mono">
                              <span style={{ color: 'var(--success)' }}>{rev.wins}W</span> / <span style={{ color: 'var(--danger)' }}>{rev.losses}L</span>
                            </td>
                            <td className="text-right mono">
                              <span style={{ color: rev.winRate >= 50 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                                {rev.winRate}%
                              </span>
                            </td>
                            <td className="text-right mono">
                              <span style={{ color: rev.netPnl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                                {formatINR(rev.netPnl)}
                              </span>
                            </td>
                            <td className="text-right mono">{rev.avgDiscipline} / 10</td>
                            <td className="text-right mono">{rev.planAdherence}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================= */}
      {/* SLIDING DRAWER: JOURNAL ENTRY COMPLETE DETAILS            */}
      {/* ========================================================= */}
      {selectedEntry && (
        <>
          <div className="drawer-overlay" onClick={() => setSelectedEntry(null)} />
          <div className="drawer" style={{ maxWidth: 520, overflowY: 'auto' }}>
            <div className="drawer-header">
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Journal Entry Details</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                  {selectedEntry.symbol} · {selectedEntry.direction}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {formatDate(selectedEntry.entryTime || selectedEntry.createdAt)} at {formatTime(selectedEntry.entryTime || selectedEntry.createdAt)}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSelectedEntry(null)}>
                <X size={18} />
              </button>
            </div>

            {/* Quick summary badges */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              <span className={`badge ${selectedEntry.direction === 'BUY' || selectedEntry.direction === 'LONG' ? 'badge-success' : 'badge-danger'}`}>
                {selectedEntry.direction}
              </span>
              <span className="badge badge-neutral">{selectedEntry.segment}</span>
              <span className="badge badge-neutral">{selectedEntry.strategy}</span>
              {selectedEntry.status === 'DRAFT' && <span className="badge badge-warning">DRAFT</span>}
            </div>

            {/* Financial metrics */}
            <div style={{ padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Entry Price</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>₹{Number(selectedEntry.entryPrice || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Exit Price</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{selectedEntry.exitPrice ? `₹${Number(selectedEntry.exitPrice).toLocaleString('en-IN')}` : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net P&amp;L</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: (selectedEntry.netPnl || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {selectedEntry.netPnl != null ? formatINR(selectedEntry.netPnl) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4 Pre-Trade Review */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                Pre-Trade Review
              </div>
              {[
                ['Thesis / Why Entering', selectedEntry.preTrade?.whyEntering || selectedEntry.entryReasoning],
                ['Setup', selectedEntry.preTrade?.setup || selectedEntry.setup],
                ['Confirmation Trigger', selectedEntry.preTrade?.confirmation],
                ['Planned Stop-Loss', selectedEntry.preTrade?.plannedStopLoss ? `₹${selectedEntry.preTrade.plannedStopLoss}` : '—'],
                ['Planned Target', selectedEntry.preTrade?.plannedTarget ? `₹${selectedEntry.preTrade.plannedTarget}` : '—'],
                ['Planned R:R', selectedEntry.preTrade?.plannedRiskReward ? `1 : ${selectedEntry.preTrade.plannedRiskReward}` : '—'],
                ['Confidence Level', selectedEntry.preTrade?.confidenceLevel],
                ['Invalidation Criteria', selectedEntry.preTrade?.invalidationCriteria],
              ].map(([k, v]) => v ? (
                <div key={k} style={{ marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v}</span>
                </div>
              ) : null)}
            </div>

            {/* Section 4 Post-Trade Review */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                Post-Trade Review
              </div>
              {[
                ['Why Exited', selectedEntry.postTrade?.whyExited || selectedEntry.exitReasoning],
                ['Followed Plan?', selectedEntry.postTrade?.followedPlan ? 'Yes' : 'No'],
                ['Was Entry Correct?', selectedEntry.postTrade?.wasEntryCorrect ? 'Yes' : 'No'],
                ['Was Exit Correct?', selectedEntry.postTrade?.wasExitCorrect ? 'Yes' : 'No'],
                ['Modified Stop-Loss?', selectedEntry.postTrade?.modifiedStopLoss ? 'Yes' : 'No'],
                ['Exited Early?', selectedEntry.postTrade?.exitedEarly ? 'Yes' : 'No'],
                ['Lessons Learned', selectedEntry.postTrade?.lessonsLearned || selectedEntry.lessonsLearned],
                ['Improvements for Next Time', selectedEntry.postTrade?.improvements],
              ].map(([k, v]) => v ? (
                <div key={k} style={{ marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v}</span>
                </div>
              ) : null)}
            </div>

            {/* Section 5 Psychology */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                Trading Psychology &amp; Discipline
              </div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>Discipline Score: </span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  {selectedEntry.psychology?.disciplineScore ?? 8} / 10
                </span>
              </div>
              {selectedEntry.psychology?.preTradeEmotions?.length > 0 && (
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Pre-Trade Emotions: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{selectedEntry.psychology.preTradeEmotions.join(', ')}</span>
                </div>
              )}
              {selectedEntry.psychology?.postTradeEmotionalState && (
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Post-Trade Emotional State: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{selectedEntry.psychology.postTradeEmotionalState}</span>
                </div>
              )}
            </div>

            {/* Mistakes tagged */}
            {selectedEntry.mistakes?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                  Mistakes Tagged
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedEntry.mistakes.map((m) => (
                    <span key={m} className="badge badge-danger" style={{ fontSize: 11 }}>
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Attachments preview */}
            {selectedEntry.attachments?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                  Attachments ({selectedEntry.attachments.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                  {selectedEntry.attachments.map((att, idx) => (
                    <div key={idx} style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {att.mimeType?.startsWith('image/') ? (
                        <img
                          src={att.url}
                          alt={att.caption || 'Attachment'}
                          style={{ width: '100%', height: 90, objectFit: 'cover', cursor: 'pointer' }}
                          onClick={() => setImagePreviewModal(att.url)}
                        />
                      ) : (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ height: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--accent)' }}
                        >
                          <FileText size={24} />
                          <span style={{ fontSize: 10, marginTop: 4 }}>View PDF</span>
                        </a>
                      )}
                      <div style={{ padding: '4px 6px', fontSize: 10, color: 'var(--text-muted)', truncate: true }}>
                        {att.attachmentType}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions in drawer */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => startEditEntry(selectedEntry)}
              >
                <Edit3 size={15} /> Edit Entry
              </button>
              <button
                className="btn btn-secondary"
                style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                onClick={(e) => handleDelete(selectedEntry._id, e)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Enlarged image preview modal */}
      {imagePreviewModal && (
        <>
          <div className="modal-overlay" onClick={() => setImagePreviewModal(null)} />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1100,
              maxWidth: '90vw',
              maxHeight: '90vh',
              background: 'var(--bg-secondary)',
              padding: 16,
              borderRadius: 'var(--radius)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button className="icon-btn" onClick={() => setImagePreviewModal(null)}>
                <X size={18} />
              </button>
            </div>
            <img
              src={imagePreviewModal}
              alt="Enlarged chart screenshot"
              style={{ maxWidth: '85vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 4 }}
            />
          </div>
        </>
      )}
    </>
  );
}

