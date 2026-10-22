import React, { useEffect, useState } from 'react';
import { Card, InfoBanner } from '../components/Card';
import { Info, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BROKER_META } from '../data/mockData';

export default function BrokerComparison() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState({
    UPSTOX: true,
    ANGEL_ONE: true,
    DHAN: true,
  });
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const rows = brokers.filter((r) => visible[r.broker]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Broker comparison</h1>
        <p className="page-description">
          Compare broker charge configurations and connection status.
        </p>
      </div>

      <InfoBanner icon={Info}>
        Values are loaded from TradeGuard backend broker configurations and your saved accounts.
      </InfoBanner>

      {error && (
        <div className="info-banner" role="alert">
          Could not load broker data: {error}
        </div>
      )}

      <Card>
        <div className="card-title" style={{ marginBottom: 12 }}>Brokers shown</div>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          {Object.entries(BROKER_META).map(([key, meta]) => (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={(e) => setVisible((v) => ({ ...v, [key]: e.target.checked }))}
              />
              {meta.name}
            </label>
          ))}
        </div>
      </Card>

      <Card padded={false} className="mt-4">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Broker</th>
                <th>Delivery</th>
                <th>Intraday</th>
                <th>Supported segments</th>
                <th>Connection label</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                    Loading broker data…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                    No brokers available.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const meta = BROKER_META[r.broker];
                  return (
                    <tr key={r.broker}>
                      <td>
                        <div className="text-primary">{meta?.name || r.name || r.broker}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>From backend config</div>
                      </td>
                      <td className="mono">{r.delivery}</td>
                      <td className="mono">{r.intraday}</td>
                      <td>{r.segments}</td>
                      <td>
                        {r.connection === 'Not configured' ? (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => navigate('/app/broker-accounts/new')}
                          >
                            <Link2 size={12} /> Not configured
                          </button>
                        ) : (
                          <span className="badge badge-neutral">
                            <span className="badge-dot" /> {r.connection}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
