import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, User, Settings, LogOut, ChevronDown, Command } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function TopBar({ title, subtitle }) {
  const { user, logout, brokerAccounts, refreshBrokerStatus } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    refreshBrokerStatus?.();
  }, [refreshBrokerStatus]);

  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const connectedBrokers = Array.isArray(brokerAccounts) ? brokerAccounts.filter((a) => a.isConnected) : [];
  const hasConnectedBroker = connectedBrokers.length > 0;
  const brokerName = connectedBrokers.map(b => b.broker === 'DHAN' ? 'Dhan' : b.broker === 'UPSTOX' ? 'Upstox' : b.broker === 'ANGEL_ONE' ? 'Angel One' : (b.broker || 'Broker')).join(' & ');

  const initials = (user?.username || user?.email || 'NA')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">{title || 'Settings'}</div>
        <div className="topbar-subtitle">{subtitle || 'Sample workspace · Last reviewed 28 Sep 2026'}</div>
      </div>

      <div className="topbar-right">
        {/* Live Broker Connection Badge */}
        <div
          onClick={() => navigate('/app/broker-accounts')}
          title={hasConnectedBroker ? `${brokerName} Credentials Active & Verified` : 'Broker Token Expired or Not Connected. Click to update credentials.'}
          style={{ cursor: 'pointer' }}
        >
          {hasConnectedBroker ? (
            <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 12 }}>
              <span className="badge-dot" />
              {brokerName} Connected
            </span>
          ) : (
            <span
              className="badge"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                fontSize: 12
              }}
            >
              <span className="badge-dot" style={{ background: '#ef4444' }} />
              Broker Not Connected
            </span>
          )}
        </div>

        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="Search trades, symbols..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="search-kbd">⌘K</span>
        </div>

        <button className="icon-btn" title="Notifications">
          <Bell size={18} />
        </button>

        <div className="user-menu" ref={menuRef} onClick={() => setMenuOpen((o) => !o)}>
          <div className="avatar">{initials}</div>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{user?.username || 'Naman'}</span>
          <ChevronDown size={14} color="var(--text-muted)" />

          {menuOpen && (
            <div className="dropdown" onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Demo workspace</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user?.email}</div>
              </div>
              <div className="dropdown-divider" />
              <button className="dropdown-item" onClick={() => { setMenuOpen(false); navigate('/app/settings'); }}>
                <User size={15} /> Profile settings
              </button>
              <button className="dropdown-item" onClick={() => setMenuOpen(false)}>
                <Settings size={15} /> Command menu
              </button>
              <div className="dropdown-divider" />
              <button
                className="dropdown-item"
                onClick={() => { logout(); navigate('/login'); }}
              >
                <LogOut size={15} /> Sign out of demo
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}