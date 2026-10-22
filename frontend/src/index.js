import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

import Overview from './pages/Overview';
import LiveTrading from './pages/LiveTrading';
import BrokerAccounts from './pages/BrokerAccounts';
import BrokerAccountForm from './pages/BrokerAccountForm';
import Trades from './pages/Trades';
import Analytics from './pages/Analytics';
import Charges from './pages/Charges';
import RiskManagement from './pages/RiskManagement';
import Reports from './pages/Reports';
import BrokerComparison from './pages/BrokerComparison';
import Settings from './pages/Settings';

import './index.css';

function Protected({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

const PAGE_META = {
  live: { title: 'Live Trading', subtitle: 'Real-time WebSocket market feed · Upstox stream' },
  overview: { title: 'Overview', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  'broker-accounts': { title: 'Broker Accounts', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  trades: { title: 'Trades', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  analytics: { title: 'Analytics', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  charges: { title: 'Charges', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  risk: { title: 'Risk Management', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  reports: { title: 'Reports', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  'broker-comparison': { title: 'Broker Comparison', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
  settings: { title: 'Settings', subtitle: 'Sample workspace · Last reviewed 28 Sep 2026' },
};

function AppPage({ page, children }) {
  const meta = PAGE_META[page] || {};
  return <Layout title={meta.title} subtitle={meta.subtitle}>{children}</Layout>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Navigate to={isAuthenticated ? '/app/overview' : '/login'} replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/app" element={<Protected><Navigate to="/app/overview" replace /></Protected>} />

      <Route path="/app/live" element={<Protected><AppPage page="live"><LiveTrading /></AppPage></Protected>} />
      <Route path="/app/overview" element={<Protected><AppPage page="overview"><Overview /></AppPage></Protected>} />
      <Route path="/app/broker-accounts" element={<Protected><AppPage page="broker-accounts"><BrokerAccounts /></AppPage></Protected>} />
      <Route path="/app/broker-accounts/new" element={<Protected><AppPage page="broker-accounts"><BrokerAccountForm /></AppPage></Protected>} />
      <Route path="/app/broker-accounts/:id/edit" element={<Protected><AppPage page="broker-accounts"><BrokerAccountForm /></AppPage></Protected>} />
      <Route path="/app/trades" element={<Protected><AppPage page="trades"><Trades /></AppPage></Protected>} />
      <Route path="/app/analytics" element={<Protected><AppPage page="analytics"><Analytics /></AppPage></Protected>} />
      <Route path="/app/charges" element={<Protected><AppPage page="charges"><Charges /></AppPage></Protected>} />
      <Route path="/app/risk" element={<Protected><AppPage page="risk"><RiskManagement /></AppPage></Protected>} />
      <Route path="/app/reports" element={<Protected><AppPage page="reports"><Reports /></AppPage></Protected>} />
      <Route path="/app/broker-comparison" element={<Protected><AppPage page="broker-comparison"><BrokerComparison /></AppPage></Protected>} />
      <Route path="/app/settings" element={<Protected><AppPage page="settings"><Settings /></AppPage></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);