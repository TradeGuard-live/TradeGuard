import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, MoreHorizontal, Link2, AlertTriangle, Upload } from 'lucide-react';
import { Card, InfoBanner } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BROKER_META } from '../data/mockData';

export default function BrokerAccounts() {
  const { user, refreshBrokerStatus } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncingId, setSyncingId] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listBrokerAccounts(user?.userId);
      // handle { data: [...] } or [...]
      const list = Array.isArray(data) ? data : data.data || [];
      setAccounts(list);
      refreshBrokerStatus?.();
    } catch (err) {
      setError(err.message || 'Failed to load broker accounts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, []);

  async function handleSync(id) {
    setSyncingId(id);
    try {
      const response = await api.syncBrokerTrades(id);
      const data = response?.data;
      if (data) {
        toast.push(
          `Sync complete — ${data.inserted || 0} new, ${data.updated || 0} updated, ${data.skipped || 0} skipped`,
          'success'
        );
        if (data.note) {
          toast.push(data.note, 'info');
        }
      } else {
        toast.push('Sync complete', 'success');
      }
      await load();
    } catch (err) {
      toast.push(err.message || 'Failed to sync trades', 'error');
    } finally {
      setSyncingId(null);
    }
  }

  const [verifyingId, setVerifyingId] = useState(null);

  async function handleVerify(id) {
    setVerifyingId(id);
    try {
      const res = await api.verifyBrokerAccount(id);
      if (res.isConnected) {
        toast.push(res.message || 'Credentials verified — Broker account is connected!', 'success');
      } else {
        toast.push(res.message || 'Broker access token is expired or invalid. Please update credentials.', 'warning');
      }
      await load();
    } catch (err) {
      toast.push(err.message || 'Failed to verify broker account', 'error');
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleConnect(id) {
    navigate(`/app/broker-accounts/${id}/edit`);
  }

  const [importingId, setImportingId] = useState(null);
  const fileInputRef = React.useRef(null);
  const importTargetId = React.useRef(null);
  const importTargetBroker = React.useRef(null);

  function handleImportClick(accId, broker) {
    importTargetId.current = accId;
    importTargetBroker.current = broker;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function handleCsvImport(e) {
    const file = e.target.files?.[0];
    if (!file || !importTargetId.current) return;

    const broker = importTargetBroker.current;
    setImportingId(importTargetId.current);
    try {
      const response = broker === 'KOTAK_NEO'
        ? await api.importKotakNeoCsv(importTargetId.current, file)
        : await api.importAngelOneCsv(importTargetId.current, file);
      const data = response?.data;
      if (data) {
        toast.push(
          `Import complete — ${data.inserted || 0} new trades added, ${data.updated || 0} updated`,
          'success'
        );
      } else {
        toast.push(response?.message || 'Import complete', 'success');
      }
      await load();
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to import file';
      toast.push(errMsg, 'error');
    } finally {
      setImportingId(null);
      importTargetId.current = null;
    }
  }

  return (
    <>
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Broker accounts</h1>
          <p className="page-description">Review and manage connected broker accounts and trade synchronization.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/app/broker-accounts/new')}>
          <Link2 size={15} /> Connect broker
        </button>
      </div>

      {loading && (
        <div className="broker-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="broker-card">
              <div className="skeleton" style={{ height: 40, width: 40, marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 16, width: '60%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: '40%' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <Card>
          <div className="empty-state">
            <AlertTriangle size={32} />
            <h3>Could not load broker accounts</h3>
            <p>{error}</p>
            <button className="btn btn-secondary" onClick={load}>
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        </Card>
      )}

      {!loading && !error && accounts.length === 0 && (
        <Card>
          <div className="empty-state">
            <Link2 size={32} />
            <h3>No broker accounts yet</h3>
            <p>Connect a broker account to start tracking your trades.</p>
            <button className="btn btn-primary" onClick={() => navigate('/app/broker-accounts/new')}>
              <Plus size={15} /> Add broker account
            </button>
          </div>
        </Card>
      )}

      {!loading && !error && accounts.length > 0 && (
        <div className="broker-grid">
          {accounts.map((acc) => {
            const meta = BROKER_META[acc.broker] || { name: acc.broker, short: '?', color: '#666' };
            const connected = acc.isConnected;
            const actionNeeded = !acc.isActive;
            const syncing = syncingId === acc._id;

            return (
              <div className="broker-card" key={acc._id}>
                <div className="broker-card-header">
                  <div
                    className="broker-avatar"
                    style={{ color: meta.color, borderColor: meta.color + '40' }}
                  >
                    {meta.short}
                  </div>
                  <button className="icon-btn" onClick={() => navigate(`/app/broker-accounts/${acc._id}/edit`)}>
                    <MoreHorizontal size={16} />
                  </button>
                </div>

                <div className="broker-name">{meta.name}</div>
                <div style={{ marginTop: 6 }}>
                  {!acc.isActive ? (
                    <span className="badge badge-warning">
                      <span className="badge-dot" /> Inactive
                    </span>
                  ) : connected ? (
                    <span className="badge badge-success">
                      <span className="badge-dot" /> Connected &amp; Valid
                    </span>
                  ) : (
                    <div>
                      <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                        <span className="badge-dot" style={{ background: '#ef4444' }} /> Not Connected
                      </span>
                      {acc.verificationError && (
                        <div style={{ fontSize: 11, color: '#f87171', marginTop: 5, lineHeight: 1.3 }}>
                          {acc.verificationError}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 14 }}>
                  <div className="broker-meta">
                    <span>Account</span>
                    <span className="mono">
                      {acc.credentials?.clientId
                        ? `•••• ${String(acc.credentials.clientId).slice(-4)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="broker-meta">
                    <span>Last verified</span>
                    <span>
                      {acc.lastConnectedAt
                        ? new Date(acc.lastConnectedAt).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </span>
                  </div>
                </div>

                <div className="broker-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    className={`btn ${actionNeeded || !connected ? 'btn-primary' : 'btn-secondary'} w-full`}
                    onClick={() => connected ? handleSync(acc._id) : handleConnect(acc._id)}
                    disabled={syncing}
                  >
                    {syncing ? (
                      <><span className="spinner" /> Syncing trades…</>
                    ) : connected ? (
                      <><RefreshCw size={14} /> Sync trades</>
                    ) : (
                      <><Link2 size={14} /> Update Credentials</>
                    )}
                  </button>

                  <button
                    className="btn btn-secondary w-full"
                    style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => handleVerify(acc._id)}
                    disabled={verifyingId === acc._id}
                  >
                    {verifyingId === acc._id ? 'Checking with Broker API...' : 'Test Broker Live Status'}
                  </button>

                  {(acc.broker?.toUpperCase() === 'ANGEL_ONE' || acc.broker?.toUpperCase() === 'KOTAK_NEO') && (
                    <button
                      className="btn btn-secondary w-full"
                      style={{ fontSize: 12, padding: '6px 12px', borderColor: acc.broker?.toUpperCase() === 'KOTAK_NEO' ? 'rgba(225, 29, 72, 0.4)' : 'rgba(255, 138, 0, 0.4)' }}
                      onClick={() => handleImportClick(acc._id, acc.broker?.toUpperCase())}
                      disabled={importingId === acc._id}
                      title={`Import past trades from ${meta.name} TradeBook CSV or Excel export`}
                    >
                      {importingId === acc._id ? (
                        <><span className="spinner" /> Importing trades…</>
                      ) : (
                        <><Upload size={13} style={{ marginRight: 4 }} /> Import Trade CSV / Excel</>
                      )}
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCsvImport}
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
      />
    </>
  );
}