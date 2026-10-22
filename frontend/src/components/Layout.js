import React, { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { ToastProvider } from './Toast';

export default function Layout({ children, title, subtitle }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ToastProvider>
      <div className="app-layout">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <div className={`main-content ${collapsed ? 'collapsed' : ''}`}>
          <TopBar title={title} subtitle={subtitle} />
          <div className="page-container">{children}</div>
        </div>
      </div>
    </ToastProvider>
  );
}