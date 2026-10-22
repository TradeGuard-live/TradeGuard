import React from 'react';

export function Card({ title, subtitle, action, children, className = '', padded = true }) {
  return (
    <div className={`card ${className}`} style={!padded ? { padding: 0 } : undefined}>
      {(title || action) && (
        <div className="card-header">
          <div>
            {title && <div className="card-title">{title}</div>}
            {subtitle && <div className="card-subtitle">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, change, changeType = 'neutral', children }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {change && (
        <div className={`stat-change ${changeType}`}>
          {changeType === 'positive' && '↗'}
          {changeType === 'negative' && '↘'}
          {changeType === 'neutral' && '•'}
          <span>{change}</span>
        </div>
      )}
      {children}
    </div>
  );
}

export function InfoBanner({ children, icon: Icon }) {
  return (
    <div className="info-banner">
      {Icon && <Icon size={15} />}
      <span>{children}</span>
    </div>
  );
}