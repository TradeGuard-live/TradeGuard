const API_URL =
  process.env.REACT_APP_API_URL || 'http://localhost:5000';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const token = localStorage.getItem('tg_token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && !path.includes('/login') && !path.includes('/register')) {
      // ✅ Auto-purge expired session credentials to prevent persistent unauthorized loops
      localStorage.removeItem('tg_token');
      localStorage.removeItem('tg_user');
      localStorage.removeItem('tg_broker_accounts');
    }

    const message =
      data?.message ||
      data?.error ||
      `Request failed (${res.status})`;

    throw new ApiError(message, res.status);
  }

  return data;
}

function getStoredUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('tg_user') || 'null');

    return user?.userId || user?.id || user?._id || '';
  } catch {
    return '';
  }
}

function withUserId(path, userId) {
  if (!userId) return path;

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}userId=${encodeURIComponent(userId)}`;
}

export const api = {
  // ✅ Authenticate user via username or email
  login: (identifier, password) =>
    request('/api/users/login', {
      method: 'POST',
      body: JSON.stringify({
        email: identifier,
        username: identifier,
        identifier,
        password
      }),
    }),

  register: (username, email, password) =>
    request('/api/users/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  forgotPassword: (email) =>
    request('/api/users/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token, newPassword) =>
    request('/api/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // Broker accounts
  listBrokerAccounts: (userId = getStoredUserId(), options = {}) => {
    let path = withUserId('/api/broker-accounts', userId);
    if (options.verify) {
      const sep = path.includes('?') ? '&' : '?';
      path = `${path}${sep}verify=true`;
    }
    return request(path);
  },

  getBrokerAccount: (id) =>
    request(`/api/broker-accounts/${id}`),

  createBrokerAccount: (payload) =>
    request('/api/broker-accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBrokerAccount: (id, payload) =>
    request(`/api/broker-accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteBrokerAccount: (id) =>
    request(`/api/broker-accounts/${id}`, {
      method: 'DELETE',
    }),

  syncBrokerTrades: (id, payload = {}) =>
    request(`/api/broker-accounts/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyBrokerAccount: (id) =>
    request(`/api/broker-accounts/${id}/verify`, {
      method: 'POST',
    }),

  importAngelOneCsv: async (brokerAccountId, file) => {
    const token = localStorage.getItem('tg_token');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(
      `${API_URL}/api/webhooks/angelone/import-csv/${brokerAccountId}`,
      {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      }
    );

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new ApiError(
        data?.message || `Import failed (${res.status})`,
        res.status
      );
    }

    return data;
  },

  importKotakNeoCsv: async (brokerAccountId, file) => {
    const token = localStorage.getItem('tg_token');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(
      `${API_URL}/api/webhooks/kotakneo/import-csv/${brokerAccountId}`,
      {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      }
    );

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new ApiError(
        data?.message || `Import failed (${res.status})`,
        res.status
      );
    }

    return data;
  },


  // Trades
  listTrades: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades', userId)),

  syncAllTrades: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/sync-all', userId), {
      method: 'POST',
    }),

  createTrade: (payload) =>
    request('/api/trades', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteTrade: (id) =>
    request(`/api/trades/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  tradeSummary: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/summary', userId)),

  tradeAnalytics: (range = '30d', broker = 'all', userId = getStoredUserId()) => {
    // If second arg is a 24-char ObjectId, treat it as userId and broker as 'all'
    if (typeof broker === 'string' && broker.length === 24 && /^[0-9a-fA-F]{24}$/.test(broker)) {
      userId = broker;
      broker = 'all';
    }
    let path = `/api/trades/analytics?range=${encodeURIComponent(range)}`;
    if (broker && broker !== 'all') path += `&broker=${encodeURIComponent(broker)}`;
    return request(withUserId(path, userId));
  },

  chargesAnalytics: (range = '30d', broker = 'all', userId = getStoredUserId()) => {
    let path = `/api/trades/charges-analytics?range=${encodeURIComponent(range)}`;
    if (broker && broker !== 'all') path += `&broker=${encodeURIComponent(broker)}`;
    return request(withUserId(path, userId));
  },

  instrumentDistribution: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/instrument-distribution', userId)),

  tradeReports: (range = '30d', broker = 'all', userId = getStoredUserId()) => {
    let path = `/api/trades/reports?range=${encodeURIComponent(range)}`;
    if (broker && broker !== 'all') {
      path += `&broker=${encodeURIComponent(broker)}`;
    }
    return request(withUserId(path, userId));
  },

  riskExposures: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/risk/exposures', userId)),

  brokerComparison: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/brokers/comparison', userId)),

  calculateCharges: (payload) =>
    request('/api/trades/calculations/charges', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  liveTradingSummary: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/live-summary', userId)),

  exitPosition: (payload) =>
    request('/api/trades/exit-position', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exitAllPositions: (payload = {}) =>
    request('/api/trades/exit-all-positions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Copy Trading Endpoints
  getCopyTradingConfig: () =>
    request('/api/copy-trading/config'),

  updateCopyTradingConfig: (payload) =>
    request('/api/copy-trading/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  addFollower: (payload) =>
    request('/api/copy-trading/followers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateFollower: (id, payload) =>
    request(`/api/copy-trading/followers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteFollower: (id) =>
    request(`/api/copy-trading/followers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  triggerEmergencyStop: (reason) =>
    request('/api/copy-trading/emergency-stop', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  resetEmergencyStop: () =>
    request('/api/copy-trading/emergency-stop/reset', {
      method: 'POST',
    }),

  getCopyOrders: (page = 1, limit = 50, status = '', symbol = '') => {
    let path = `/api/copy-trading/orders?page=${page}&limit=${limit}`;
    if (status) path += `&status=${encodeURIComponent(status)}`;
    if (symbol) path += `&symbol=${encodeURIComponent(symbol)}`;
    return request(path);
  },

  getCopyMetrics: () =>
    request('/api/copy-trading/metrics'),

  getCopyAuditLogs: (page = 1, limit = 50, eventType = '', severity = '') => {
    let path = `/api/copy-trading/audit-logs?page=${page}&limit=${limit}`;
    if (eventType) path += `&eventType=${encodeURIComponent(eventType)}`;
    if (severity) path += `&severity=${encodeURIComponent(severity)}`;
    return request(path);
  },

  triggerCopyReconciliation: () =>
    request('/api/copy-trading/reconcile', {
      method: 'POST',
    }),

  syncMasterTrades: () =>
    request('/api/copy-trading/sync-master-trades', {
      method: 'POST',
    }),

  simulateMasterOrder: (payload) =>
    request('/api/copy-trading/simulate-master-order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ✅ Trading Journal Endpoints
  listJournalEntries: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'all' && v !== 'ALL') {
        query.append(k, v);
      }
    });
    const qs = query.toString();
    return request(withUserId(`/api/journal${qs ? '?' + qs : ''}`, params.userId || getStoredUserId()));
  },

  getJournalEntry: (id) =>
    request(`/api/journal/${encodeURIComponent(id)}`),

  createJournalEntry: (payload) =>
    request('/api/journal', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateJournalEntry: (id, payload) =>
    request(`/api/journal/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteJournalEntry: (id) =>
    request(`/api/journal/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getJournalAnalytics: (range = 'all') =>
    request(withUserId(`/api/journal/analytics?range=${encodeURIComponent(range)}`, getStoredUserId())),

  getJournalStrategies: () =>
    request(withUserId('/api/journal/strategies', getStoredUserId())),

  uploadJournalAttachment: async (file) => {
    const token = localStorage.getItem('tg_token');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_URL}/api/journal/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new ApiError(data?.message || `Upload failed (${res.status})`, res.status);
    }

    return data;
  },
};

const WS_URL =
  process.env.REACT_APP_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss:' : 'ws:') +
    '//' +
    (window.location.hostname || 'localhost') +
    ':5000/ws/live';

export { ApiError, WS_URL };