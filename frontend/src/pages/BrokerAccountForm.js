import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Card } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BROKER_META } from '../data/mockData';

export default function BrokerAccountForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const { user, refreshBrokerStatus } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({
    broker: 'UPSTOX',
    clientId: '',
    apiKey: '',
    apiSecret: '',
    accessToken: '',
    refreshToken: '',
    password: '',
    totpSecret: '',
    mobileNumber: '',
    tokenExpiresAt: '',
    isActive: true,
  });
  const [show, setShow] = useState({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) return;

    let active = true;

    async function loadAccount() {
      setFetching(true);
      try {
        const response = await api.getBrokerAccount(id);
        if (active) {
          const acc = response?.data || response;
          setForm((f) => ({
            ...f,
            broker: acc.broker || f.broker,
            clientId: acc.credentials?.clientId || '',
            isActive: acc.isActive ?? true,
            // Sensitive fields are never returned by the API — leave blank
            apiKey: '',
            apiSecret: '',
            accessToken: '',
            refreshToken: '',
            password: '',
            totpSecret: '',
            mobileNumber: '',
            tokenExpiresAt: '',
          }));
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Failed to load account');
        }
      } finally {
        if (active) setFetching(false);
      }
    }

    loadAccount();
    return () => { active = false; };
  }, [id, isEdit]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.broker || !form.clientId) {
      setError('Broker and client ID are required');
      return;
    }

    setLoading(true);
    try {
      if (isEdit) {
        const payload = {
          broker: form.broker,
          isActive: form.isActive,
          credentials: { clientId: form.clientId },
        };
        if (form.apiKey) payload.credentials.apiKey = form.apiKey;
        if (form.apiSecret) payload.credentials.apiSecret = form.apiSecret;
        if (form.accessToken) payload.credentials.accessToken = form.accessToken;
        if (form.refreshToken) payload.credentials.refreshToken = form.refreshToken;
        if (form.password) payload.credentials.password = form.password;
        if (form.totpSecret) payload.credentials.totpSecret = form.totpSecret;
        if (form.mobileNumber) payload.credentials.mobileNumber = form.mobileNumber;
        if (form.tokenExpiresAt) payload.credentials.tokenExpiresAt = form.tokenExpiresAt;
        const res = await api.updateBrokerAccount(id, payload);
        toast.push(res?.message || 'Broker account updated', res?.data?.isConnected ? 'success' : 'info');
      } else {
        const payload = {
          userId: user?.id,
          broker: form.broker,
          credentials: { clientId: form.clientId },
        };
        if (form.apiKey) payload.credentials.apiKey = form.apiKey;
        if (form.apiSecret) payload.credentials.apiSecret = form.apiSecret;
        if (form.accessToken) payload.credentials.accessToken = form.accessToken;
        if (form.refreshToken) payload.credentials.refreshToken = form.refreshToken;
        if (form.password) payload.credentials.password = form.password;
        if (form.totpSecret) payload.credentials.totpSecret = form.totpSecret;
        if (form.mobileNumber) payload.credentials.mobileNumber = form.mobileNumber;
        if (form.tokenExpiresAt) payload.credentials.tokenExpiresAt = form.tokenExpiresAt;
        const res = await api.createBrokerAccount(payload);
        toast.push(res?.message || 'Broker account created successfully', 'success');
      }
      refreshBrokerStatus?.();
      navigate('/app/broker-accounts');
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  }

  function SecretField({ name, label, placeholder }) {
    return (
      <div className="form-group">
        <label className="form-label">{label}</label>
        <div className="input-with-icon">
          <input
            type={show[name] ? 'text' : 'password'}
            className="form-input"
            placeholder={placeholder}
            value={form[name]}
            onChange={(e) => update(name, e.target.value)}
          />
          <button
            type="button"
            className="input-icon-btn"
            onClick={() => setShow((s) => ({ ...s, [name]: !s[name] }))}
          >
            {show[name] ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
    );
  }

  if (fetching) {
    return (
      <>
        <div className="page-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="page-title">Edit broker account</h1>
        </div>
        <Card>
          <p>Loading account data…</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="page-title">{isEdit ? 'Edit broker account' : 'Connect broker account'}</h1>
        <p className="page-description">
          {isEdit
            ? 'Update credentials and connection status. Leave credential fields blank to keep existing values.'
            : 'Add a new broker account. Credentials are write-only and never returned by the API.'}
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
          <div className="form-group">
            <label className="form-label">Broker</label>
            <select
              className="form-select"
              value={form.broker}
              onChange={(e) => update('broker', e.target.value)}
              disabled={isEdit}
            >
              {Object.entries(BROKER_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.name}</option>
              ))}
            </select>
          </div>

          {form.broker === 'ANGEL_ONE' && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              fontSize: '0.875rem',
              color: '#d97706'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Angel One SmartAPI Setup Guide:</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5, color: 'inherit' }}>
                <li><strong>API Key:</strong> Generated from your app on <a href="https://smartapi.angelbroking.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>smartapi.angelbroking.com</a>.</li>
                <li><strong>QR Code & Secret Key:</strong> When enabling TOTP at <a href="https://smartapi.angelbroking.com/enable-totp" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>smartapi.angelbroking.com/enable-totp</a>, you get a QR code and an alphanumeric secret key under it.</li>
                <li><strong>Automatic Login:</strong> Paste that Secret Key in <em>TOTP Secret Key</em> along with your Trading PIN. TradeGuard automatically computes your 6-digit Google Authenticator TOTP and keeps your session active!</li>
              </ul>
            </div>
          )}

          {form.broker === 'KOTAK_NEO' && (
            <div style={{
              background: 'rgba(225, 29, 72, 0.08)',
              border: '1px solid rgba(225, 29, 72, 0.25)',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              fontSize: '0.875rem',
              color: '#e11d48'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Kotak Neo Trade API Setup Guide:</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5, color: 'inherit' }}>
                <li><strong>API Access Token:</strong> In Neo App or Web portal, navigate to <em>More → TradeAPI → API Dashboard</em>, click <em>Create Application</em> and copy the token.</li>
                <li><strong>TOTP Registration:</strong> In API Dashboard on the top right, click <em>TOTP Registration</em>, scan the QR code with Google Authenticator, and copy the alphanumeric setup key.</li>
                <li><strong>UCC & MPIN:</strong> Your 5-digit Client Code from Profile, and your 6-digit Trading MPIN.</li>
                <li><strong>Automatic 2-Step Login:</strong> TradeGuard will automatically compute your 6-digit TOTP, validate your MPIN, and maintain your active trading session!</li>
              </ul>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              {form.broker === 'DHAN' 
                ? 'Dhan Client ID (e.g. 1000000001) *' 
                : form.broker === 'ANGEL_ONE'
                ? 'Angel One Client ID (e.g. A123456) *'
                : form.broker === 'KOTAK_NEO'
                ? 'Kotak Neo UCC / Client Code (e.g. AB123) *'
                : 'Client ID *'}
            </label>
            <input
              className="form-input"
              placeholder={
                form.broker === 'DHAN' 
                  ? 'e.g. 1000000001 (found in Dhan profile)' 
                  : form.broker === 'ANGEL_ONE'
                  ? 'e.g. A123456 (your Angel One Client ID)'
                  : form.broker === 'KOTAK_NEO'
                  ? 'e.g. AB123 (your 5-digit Kotak Neo UCC)'
                  : 'e.g. Upstox UCC or Client ID'
              }
              value={form.clientId}
              onChange={(e) => update('clientId', e.target.value)}
            />
          </div>

          {form.broker === 'ANGEL_ONE' && (
            <>
              <SecretField 
                name="apiKey" 
                label="SmartAPI API Key *" 
                placeholder="Paste API Key from SmartAPI App (X-PrivateKey)" 
              />
              <SecretField 
                name="password" 
                label="Trading PIN / MPIN *" 
                placeholder="4-digit trading PIN or account password" 
              />
              <SecretField 
                name="totpSecret" 
                label="TOTP Secret Key (from QR Code setup page) *" 
                placeholder="Alphanumeric secret key under the QR code (e.g. JBSWY3...)" 
              />
              <SecretField 
                name="accessToken" 
                label="Access Token (Optional - generated automatically from PIN & TOTP Key)" 
                placeholder="Optional manual JWT Bearer Token (starts with eyJ...)" 
              />
            </>
          )}

          {form.broker === 'KOTAK_NEO' && (
            <>
              <div style={{
                padding: '12px 14px',
                marginBottom: '16px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                fontSize: '12.5px',
                lineHeight: 1.5,
                color: 'var(--text-secondary, #94a3b8)'
              }}>
                <div style={{ fontWeight: 600, color: 'var(--primary, #3b82f6)', marginBottom: '4px' }}>
                  ℹ️ Kotak Neo Connection Instructions
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  <li><strong>Client Code (UCC)</strong>: Your 5-character Kotak UCC (e.g. W0WLI).</li>
                  <li><strong>Neo API Access Token</strong>: Copied from your Kotak Neo Trade API Dashboard.</li>
                  <li><strong>TOTP Secret Key</strong>: The setup key from Kotak Neo TradeAPI TOTP Registration. <em>Note: If you click TOTP Registration again in Kotak's portal, it invalidates the previous key.</em></li>
                  <li><strong>Session Token (Optional)</strong>: If your TOTP secret is out of sync, you can paste an active Trading Token directly.</li>
                </ul>
              </div>
              <SecretField 
                name="apiKey" 
                label="Neo API Access Token (from API Dashboard) *" 
                placeholder="Paste API token from TradeAPI Dashboard (e.g. ec6a746c-...)" 
              />
              <div className="form-group">
                <label className="form-label">Registered Mobile Number *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. +919876543210 or 10-digit mobile"
                  value={form.mobileNumber}
                  onChange={(e) => update('mobileNumber', e.target.value)}
                />
              </div>
              <SecretField 
                name="password" 
                label="6-Digit Trading MPIN *" 
                placeholder="Your 6-digit MPIN used for trading in Neo app" 
              />
              <SecretField 
                name="totpSecret" 
                label="TOTP Secret Key (from QR Setup) OR Current 6-digit Authenticator Code *" 
                placeholder="Enter Base32 Secret Key for 24/7 auto-login OR enter your current 6-digit TOTP code" 
              />
              <SecretField 
                name="accessToken" 
                label="Trading Session Token (Optional - generated automatically via MPIN & TOTP)" 
                placeholder="Optional manual Trading Token (starts with eyJ...)" 
              />
            </>
          )}

          {form.broker !== 'ANGEL_ONE' && form.broker !== 'KOTAK_NEO' && (
            <SecretField 
              name="accessToken" 
              label={
                form.broker === 'DHAN' 
                  ? 'Dhan Access Token (JWT from DhanHQ API portal) *' 
                  : 'Upstox Access Token (Bearer JWT) *'
              } 
              placeholder={
                form.broker === 'DHAN' 
                  ? 'Paste Dhan 24-hr access token (from dhanhq.co)' 
                  : 'Paste Upstox Bearer access token'
              } 
            />
          )}

          {form.broker === 'UPSTOX' && (
            <>
              <SecretField 
                name="apiKey" 
                label="API Key (Optional)" 
                placeholder="Optional" 
              />
              <SecretField 
                name="apiSecret" 
                label="API Secret (Optional)" 
                placeholder="Optional" 
              />
              <SecretField 
                name="refreshToken" 
                label="Refresh Token (Optional)" 
                placeholder="Optional" 
              />
            </>
          )}

          <div className="form-group">
            <label className="form-label">Token expires at</label>
            <input
              type="datetime-local"
              className="form-input"
              value={form.tokenExpiresAt}
              onChange={(e) => update('tokenExpiresAt', e.target.value)}
            />
          </div>

          {isEdit && (
            <div className="form-group">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => update('isActive', e.target.checked)}
                />
                Account active
              </label>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : isEdit ? 'Save changes' : 'Create account'}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
