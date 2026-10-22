import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/Card';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client';

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
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [range, setRange] = useState('all');
  const [broker, setBroker] = useState('all');
  const [side, setSide] = useState('all');
  const [search, setSearch] = useState('');
  const [drawerTrade, setDrawerTrade] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadTrades() {
      setLoading(true);
      setError('');

      try {
        const response = await api.listTrades();

        if (active) {
          setTrades(Array.isArray(response?.data) ? response.data : []);
        }
      } catch (err) {
        if (active) {
          setError(
            err?.response?.data?.message ||
              err?.message ||
              'Unable to load saved trades.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTrades();

    return () => {
      active = false;
    };
  }, []);

  const brokers = useMemo(
    () => [...new Set(trades.map((trade) => trade.broker).filter(Boolean))].sort(),
    [trades]
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const isAll = range === 'all';
    const days = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : range === '1y' ? 365 : range === '30d' ? 30 : null;
    const cutoff = days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null;

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
          if (tradeDate > now) {
            return false;
          }
        } else if (!isAll) {
          return false;
        }

        if (broker !== 'all' && trade.broker !== broker) return false;

        if (side !== 'all' && trade.transactionType !== side) return false;

        if (query) {
          const searchableText = [
            trade.symbol,
            trade.tradeId,
            trade.orderId,
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
  }, [trades, range, broker, side, search]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Trade history</h1>
        <p className="page-description">
          Search, filter, and inspect executions saved from your connected broker accounts.
        </p>
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
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Symbol</th>
                <th>Broker</th>
                <th>Side</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Execution price</th>
                <th>Order type</th>
                <th>Order ID</th>
                <th>Trade ID</th>
              </tr>
            </thead>

            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
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
                        {trade.segment || trade.exchange || '—'}
                      </div>
                    </td>

                    <td>{trade.broker || '—'}</td>

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
              ['Side', drawerTrade.transactionType],
              ['Quantity', drawerTrade.quantity],
              [
                'Execution price',
                getExecutionPrice(drawerTrade) == null
                  ? '—'
                  : formatINR(getExecutionPrice(drawerTrade)),
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
              Realized P&amp;L is not shown for an individual execution. It
              requires matching buy and sell executions and applying the
              selected accounting method.
            </div>
          </div>
        </>
      )}
    </>
  );
}