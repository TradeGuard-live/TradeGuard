// Static broker metadata used for display purposes and historical migration safety.
// All trade/analytics/report data is fetched from the backend API.

// ✅ Active supported brokers for new account integrations (Kotak Neo deprecated)
export const SUPPORTED_BROKERS = {
  UPSTOX: { name: 'Upstox', short: 'U', color: '#7c3aed' },
  ANGEL_ONE: { name: 'Angel One', short: 'A', color: '#f59e0b' },
  DHAN: { name: 'Dhan', short: 'D', color: '#10b981' },
  GROWW: { name: 'Groww', short: 'G', color: '#00d09c' },
  ZERODHA: { name: 'Zerodha', short: 'Z', color: '#387ed1' },
};

// Comprehensive broker metadata for historical trade records and display
export const BROKER_META = {
  UPSTOX: { name: 'Upstox', short: 'U', color: '#7c3aed' },
  ANGEL_ONE: { name: 'Angel One', short: 'A', color: '#f59e0b' },
  DHAN: { name: 'Dhan', short: 'D', color: '#10b981' },
  GROWW: { name: 'Groww', short: 'G', color: '#00d09c' },
  ZERODHA: { name: 'Zerodha', short: 'Z', color: '#387ed1' },
  KOTAK_NEO: { name: 'Kotak Neo (Legacy)', short: 'K', color: '#e11d48' },
  KOTAK_NEO_YOUTH: { name: 'Kotak Neo Youth (Legacy)', short: 'KY', color: '#be123c' },
};
