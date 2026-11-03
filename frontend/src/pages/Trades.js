import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom'; // ✅ Navigation for journal integration
import { Card } from '../components/Card';
import { X, ChevronLeft, ChevronRight, Trash2, RefreshCw, BookOpen } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

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
    year: 'numeric',
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

function formatINR(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function getExecutionPrice(trade) {
  return trade.executedPrice ?? trade.averagePrice ?? trade.price;
}

function getExecutionId(trade) {
  return trade.tradeId || trade.orderId || trade._id || 'Execution';
}

export default function Trades() {
  const navigate = useNavigate(); // ✅ Navigate to journal
  const toast = useToast();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [range, setRange] = useState('all');
  const [broker, setBroker] = useState('all');
  const [side, setSide] = useState('all');
  const [product, setProduct] = useState('all');
  const [search, setSearch] = useState('');
  const [drawerTrade, setDrawerTrade] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadTrades = React.useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const response = await api.listTrades();
      setTrades(Array.isArray(response?.data) ? response.data : []);
    } catch (err) {
      if (!silent) {
        setError(
          err?.response?.data?.message ||
            err?.message ||
            'Unable to load saved trades.'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrades(false);

    // ✅ Listen for live WebSocket trade executions and auto-sync events
    const handleTradesUpdated = () => {
      loadTrades(true);
    };

    window.addEventListener('tg_trades_updated', handleTradesUpdated);
    return () => {
      window.removeEventListener('tg_trades_updated', handleTradesUpdated);
    };
  }, [loadTrades]);

  const brokers = useMemo(
    () => [...new Set(trades.map((trade) => trade.broker).filter(Boolean))].sort(),
    [trades]
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const isAll = range === 'all';
    let cutoff = null;
    if (range === '1d') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (range === '7d') {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === '90d') {
      cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (range === '1y') {
      cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    const query = search.trim().toLowerCase();

    return trades
      .filter((trade) => {
        const tradeDateValue = getTradeDate(trade);

        if (tradeDateValue) {
          const tradeDate = new Date(tradeDateValue);

          if (Number.isNaN(tradeDate.getTime())) {
            return false;
          }
          if (!isAll && cutoff && tradeDate < cutoff) {
            return false;
          }
        } else if (!isAll) {
          return false;
        }

        if (broker !== 'all' && trade.broker !== broker) return false;

        if (side !== 'all' && trade.transactionType !== side) return false;

        if (product !== 'all') {
          const prod = String(trade.productCode || trade.productType || 'INTRADAY').toUpperCase();
          if (product === 'INTRADAY' && !prod.includes('INTRA') && !prod.includes('MIS')) return false;
          if (product === 'DELIVERY' && !prod.includes('DELIV') && !prod.includes('CNC')) return false;
        }

        if (query) {
          const searchableText = [
            trade.symbol,
            trade.tradeId,
            trade.orderId,
            trade.productCode,
            trade.productType,
            trade._id,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!searchableText.includes(query)) return false;
        }

        return true;
      })
      .sort(
        (a, b) =>
          new Date(getTradeDate(b)).getTime() -
          new Date(getTradeDate(a)).getTime()
      );
  }, [trades, range, broker, side, product, search]);

  async function handleDeleteTrade(trade, e) {
    if (e) e.stopPropagation();
    if (!trade?._id) return;

    const confirmMsg = `Are you sure you want to delete this trade: ${trade.symbol} (${trade.transactionType} ${trade.quantity} @ ${formatINR(getExecutionPrice(trade))})?`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingId(trade._id);
    try {
      await api.deleteTrade(trade._id);
      setTrades((prev) => prev.filter((t) => t._id !== trade._id));
      if (drawerTrade?._id === trade._id) {
        setDrawerTrade(null);
      }
      toast.push('Trade deleted successfully', 'success');
    } catch (err) {
      toast.push(err.message || 'Failed to delete trade', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSyncTrades() {
    setSyncing(true);
    try {
      const res = await api.syncAllTrades();
      if (res?.data && Array.isArray(res.data)) {
        setTrades(res.data);
      } else {
        await loadTrades(false);
      }
      const inserted = res?.result?.inserted ?? 0;
      const updated = res?.result?.updated ?? 0;
      toast.push(`Broker trade sync complete (${inserted} new added, ${updated} updated)`, 'success');
    } catch (err) {
      try {
        await loadTrades(false);
        toast.push('Trade history refreshed from database', 'info');
      } catch {
        toast.push(err.message || 'Failed to sync trades', 'error');
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Trade history</h1>
          <p className="page-description">
            Search, filter, and inspect executions saved from your connected broker accounts.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={handleSyncTrades}
          disabled={syncing || loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Sync latest executions from connected broker accounts"
        >
          <RefreshCw size={14} className={syncing ? 'spinner-rotate' : ''} />
          {syncing ? 'Syncing Live Trades…' : 'Sync Live Trades'}
        </button>
      </div>

      {error && (
        <div className="info-banner" role="alert">
          Unable to load trades: {error}
        </div>
      )}

      <Card padded={false}>
        <div style={{ padding: 20 }}>
          <div className="card-title">All executions</div>
          <div className="card-subtitle">
            {loading
              ? 'Loading saved executions…'
              : `Showing ${filtered.length} of ${trades.length} database records`}
          </div>

          <div className="filters-row" style={{ marginTop: 16 }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Search symbol, trade ID or order ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              className="filter-select"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="all">All time</option>
              <option value="1d">Last 1 day</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="1y">Last 1 year</option>
            </select>

            <select
              className="filter-select"
              value={broker}
              onChange={(event) => setBroker(event.target.value)}
            >
              <option value="all">All brokers</option>
              {brokers.map((brokerName) => (
                <option key={brokerName} value={brokerName}>
                  {brokerName}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={side}
              onChange={(event) => setSide(event.target.value)}
            >
              <option value="all">All sides</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>

            <select
              className="filter-select"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
            >
              <option value="all">All products</option>
              <option value="INTRADAY">Intraday (MIS)</option>
              <option value="DELIVERY">Delivery (CNC)</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Symbol</th>
                <th>Broker</th>
                <th>Product</th>
                <th>Side</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Execution price</th>
                <th>Order type</th>
                <th>Order ID</th>
                <th>Trade ID</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    style={{
                      textAlign: 'center',
                      padding: 40,
                      color: 'var(--text-muted)',
                    }}
                  >
                    No saved executions match your filters.
                  </td>
                </tr>
              )}

              {filtered.map((trade) => {
                const date = getTradeDate(trade);
                const sideValue = trade.transactionType;
                const productCode = trade.productCode || trade.productType || 'INTRADAY';

                return (
                  <tr
                    key={trade._id || trade.tradeId || trade.orderId}
                    onClick={() => setDrawerTrade(trade)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="text-primary">{formatDate(date)}</div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatTime(date)}
                      </div>
                    </td>

                    <td>
                      <div className="text-primary">{trade.symbol || '—'}</div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {trade.exchange || 'NSE'} · {trade.segment || 'EQUITY'}
                      </div>
                    </td>

                    <td>{trade.broker || '—'}</td>

                    <td>
                      <span
                        className="badge"
                        style={{
                          fontSize: '11px',
                          textTransform: 'uppercase',
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.25)'
                        }}
                      >
                        {productCode}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          sideValue === 'BUY'
                            ? 'badge-success'
                            : sideValue === 'SELL'
                            ? 'badge-danger'
                            : ''
                        }`}
                      >
                        {sideValue || '—'}
                      </span>
                    </td>

                    <td className="text-right mono">
                      {trade.quantity ?? '—'}
                    </td>

                    <td className="text-right mono">
                      {getExecutionPrice(trade) == null
                        ? '—'
                        : formatINR(getExecutionPrice(trade))}
                    </td>

                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                        {trade.orderType || 'MARKET'}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {trade.orderId || ('ORD-' + (trade.tradeId || trade._id))}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>{trade.tradeId || '—'}</td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="icon-btn"
                        title="Delete this trade"
                        onClick={(e) => handleDeleteTrade(trade, e)}
                        disabled={deletingId === trade._id}
                        style={{
                          color: '#ef4444',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          padding: '5px 8px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {loading
              ? 'Loading records…'
              : `Showing ${filtered.length} of ${trades.length} saved executions`}
          </span>

          <div className="flex gap-2">
            <button className="icon-btn" disabled aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <button className="icon-btn" disabled aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </Card>

      {drawerTrade && (
        <>
          <div
            className="drawer-overlay"
            onClick={() => setDrawerTrade(null)}
          />

          <div className="drawer">
            <div className="drawer-header">
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Execution details
                </div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {getExecutionId(drawerTrade)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
              ['Product', drawerTrade.productCode || drawerTrade.productType || 'INTRADAY'],
              ['Side', drawerTrade.transactionType],
              ['Quantity', drawerTrade.quantity],
              [
                'Execution price',
                getExecutionPrice(drawerTrade) == null
                  ? '—'
                  : formatINR(getExecutionPrice(drawerTrade)),
              ],
              ['Order type', drawerTrade.orderType || 'MARKET'],
              ['Segment', `${drawerTrade.exchange || 'NSE'} · ${drawerTrade.segment || 'EQUITY'}`],
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

            {/* ✅ Link to Trading Journal module with pre-filled trade data */}
            <button
              className="btn btn-primary w-full"
              style={{
                marginTop: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 16px',
                fontWeight: 600
              }}
              onClick={() => {
                navigate('/app/journal', { state: { prefillTrade: drawerTrade } });
              }}
            >
              <BookOpen size={16} /> Journal This Trade
            </button>

            <button
              className="btn btn-secondary w-full"
              style={{
                marginTop: 20,
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px'
              }}
              onClick={(e) => handleDeleteTrade(drawerTrade, e)}
              disabled={deletingId === drawerTrade._id}
            >
              <Trash2 size={15} /> Delete this trade execution
            </button>

            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              Realized P&amp;L is matched across buy and sell executions according to your selected accounting method.
            </div>
          </div>
        </>
      )}
    </>
  );
}