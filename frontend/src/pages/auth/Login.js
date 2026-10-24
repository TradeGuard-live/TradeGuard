import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Username/Email and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      navigate('/app/overview');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <Shield size={24} />
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to TradeGuard to continue</p>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Username or Email</label>
            <input
              type="text"
              className="form-input"
              placeholder="Username or you@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/forgot-password">Forgot password?</Link>
          <span style={{ margin: '0 8px' }}>·</span>
          <Link to="/register">Create an account</Link>
        </div>
      </div>
    </div>
  );
}