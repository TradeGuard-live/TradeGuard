import React, { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Shield, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = params.get('token') || params.get('resetToken') || '';
    if (t) setToken(t);
  }, [params]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!token) return setError('Reset token is missing from the URL');
    if (!password) return setError('New password is required');
    if (password !== confirm) return setError('Passwords do not match');

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-logo">
            <CheckCircle2 size={24} />
          </div>
          <h1 className="auth-title">Password reset</h1>
          <p className="auth-subtitle">Redirecting you to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <Shield size={24} />
        </div>
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-subtitle">Choose a new password for your account</p>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Reset token</label>
            <input
              className="form-input"
              placeholder="Token from your email link"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="form-hint">Auto-filled if you arrived from the email link</div>
          </div>

          <div className="form-group">
            <label className="form-label">New password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirm new password</label>
            <input
              type="password"
              className="form-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Reset password'}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}