import React, { useState } from 'react';
import { Card } from '../components/Card';
import Toggle from '../components/Toggle';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { Save, Lock, Shield } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({
    fullName: user?.username || 'Naman Ashani',
    email: user?.email || 'demo@tradeguard.app',
    currency: 'INR',
  });
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState({
    syncCompleted: true,
    riskThreshold: true,
    weeklySummary: true,
  });
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });

  function saveProfile() {
    toast.push('Profile saved locally (no backend endpoint available)', 'info');
  }

  function changePassword(e) {
    e.preventDefault();
    if (!passwordForm.next || passwordForm.next !== passwordForm.confirm) {
      toast.push('Passwords do not match', 'error');
      return;
    }
    toast.push('Password change is a demo action — no backend endpoint', 'info');
    setPasswordForm({ current: '', next: '', confirm: '' });
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Manage local preferences for this frontend preview.</p>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <Card title="Profile details" subtitle="Displayed in this demo workspace">
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input
              className="form-input"
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Default currency</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-primary)',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>₹</span>
              <span>INR — Indian Rupee (₹)</span>
              <span className="badge badge-success" style={{ marginLeft: 'auto', fontSize: 11 }}>Active &amp; Locked</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              TradeGuard is standardized exclusively on Indian Rupee (INR / ₹) for all Indian broker integrations.
            </p>
          </div>
          <button className="btn btn-primary" onClick={saveProfile}>
            <Save size={14} /> Save profile
          </button>
        </Card>

        <Card title="Appearance" subtitle="Interface display preference">
          <div className="form-group">
            <label className="form-label">Theme</label>
            <select className="form-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="dark">Dark — TradeGuard default</option>
              <option value="light" disabled>Light (coming soon)</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            This preview is optimized for the dark trading workspace.
          </p>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Notifications" subtitle="Local preference controls">
          {[
            { key: 'syncCompleted', label: 'Sync completed', desc: 'Show confirmation after a mock trade sync' },
            { key: 'riskThreshold', label: 'Risk threshold warning', desc: 'Alert when sample limits are approached' },
            { key: 'weeklySummary', label: 'Weekly performance summary', desc: 'Prepare a local summary notification' },
          ].map((n) => (
            <div
              key={n.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{n.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.desc}</div>
              </div>
              <Toggle
                checked={notifications[n.key]}
                onChange={(v) => setNotifications((s) => ({ ...s, [n.key]: v }))}
              />
            </div>
          ))}
        </Card>

        <Card title="Security and connections" subtitle="Frontend-only account actions">
          <form onSubmit={changePassword} style={{ marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">Change demo password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Current password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                style={{ marginBottom: 8 }}
              />
              <input
                type="password"
                className="form-input"
                placeholder="New password"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
                style={{ marginBottom: 8 }}
              />
              <input
                type="password"
                className="form-input"
                placeholder="Confirm new password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              <Lock size={14} /> Update password
            </button>
          </form>

          <button
            className="btn btn-secondary w-full"
            onClick={() => toast.push('Manage broker connections from Broker Accounts page', 'info')}
          >
            <Shield size={14} /> Manage broker connections
          </button>
        </Card>
      </div>
    </>
  );
}