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
  // Auth
  login: (email, password) =>
    request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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
  listBrokerAccounts: (userId = getStoredUserId()) =>
    request(withUserId('/api/broker-accounts', userId)),

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


  // Trades
  listTrades: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades', userId)),

  createTrade: (payload) =>
    request('/api/trades', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  tradeSummary: (userId = getStoredUserId()) =>
    request(withUserId('/api/trades/summary', userId)),

  tradeAnalytics: (range = '30d', userId = getStoredUserId()) =>
    request(withUserId(`/api/trades/analytics?range=${encodeURIComponent(range)}`, userId)),

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
};

const WS_URL =
  process.env.REACT_APP_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss:' : 'ws:') +
    '//' +
    (window.location.hostname || 'localhost') +
    ':5000/ws/live';

export { ApiError, WS_URL };