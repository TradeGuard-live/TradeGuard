import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_URL, api } from '../api/client';

export function useLiveTrading() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState(null);
  const [isMarketOpen, setIsMarketOpen] = useState(true);

  const [positions, setPositions] = useState([]);
  const [allPositions, setAllPositions] = useState([]);
  const [squaredPositions, setSquaredPositions] = useState([]);

  const [portfolioSummary, setPortfolioSummary] = useState({
    totalGrossPnL: 0,
    totalUnrealizedPnL: 0,
    totalRealizedPnL: 0,
    totalNetPnL: 0,
    totalInvestedCapital: 0,
    totalMarketValue: 0,
    totalRiskAmount: 0,
    portfolioRiskReward: 1,
    portfolioRiskRewardText: '1:1.0',
    totalCharges: {
      brokerage: 0,
      stt: 0,
      gst: 0,
      exchangeCharges: 0,
      ctt: 0,
      sebiCharges: 0,
      stampDuty: 0,
      dpCharges: 0,
      total: 0,
    },
    openPositionsCount: 0,
  });

  const [lastTickTime, setLastTickTime] = useState(null);
  const [priceFlash, setPriceFlash] = useState({}); // { [symbol]: 'up' | 'down' }

  const wsRef = useRef(null);
  const previousPricesRef = useRef(new Map());
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  // ✅ Retrieve current authenticated user ID from storage without hardcoded dummy fallback
  const getUserId = useCallback(() => {
    try {
      const user = JSON.parse(localStorage.getItem('tg_user') || 'null');
      return user?.userId || user?.id || user?._id || '';
    } catch {
      return '';
    }
  }, []);

  // Fetch initial HTTP snapshot
  const loadInitialSnapshot = useCallback(async () => {
    try {
      const userId = getUserId();
      if (!userId) return;
      const res = await api.liveTradingSummary(userId);
      if (res?.data && isMountedRef.current) {
        if (res.data.positions) setPositions(res.data.positions);
        if (res.data.portfolioSummary) setPortfolioSummary(res.data.portfolioSummary);
        if (res.data.allPositions) setAllPositions(res.data.allPositions);
        if (res.data.squaredPositions) setSquaredPositions(res.data.squaredPositions);
        if (typeof res.data.isMarketOpen === 'boolean') setIsMarketOpen(res.data.isMarketOpen);
      }
    } catch (err) {
      console.warn('Could not load initial snapshot via HTTP:', err.message);
    }
  }, [getUserId]);

  // Connect to WebSocket with JWT authentication
  const connectWebSocket = useCallback(() => {
    if (!isMountedRef.current) return;

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // ✅ Authenticate with JWT token & verified user ID
        const userId = getUserId();
        const token = localStorage.getItem('tg_token');
        ws.send(JSON.stringify({ type: 'AUTH', token, userId }));
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'INITIAL_DATA' || payload.type === 'LIVE_PNL_UPDATE') {
            const data = payload.data;
            if (!data) return;

            setLastTickTime(Date.now());
            if (typeof data.isMarketOpen === 'boolean') {
              setIsMarketOpen(data.isMarketOpen);
            }

            if (data.portfolioSummary) {
              setPortfolioSummary(data.portfolioSummary);
            }

            if (Array.isArray(data.positions)) {
              // Calculate price flash (up/down tick) only during open market with valid quotes
              const flashUpdates = {};
              data.positions.forEach((p) => {
                const sym = p.symbol || p.instrumentToken;
                const prev = previousPricesRef.current.get(sym);
                if (prev !== undefined && p.ltp !== prev && p.ltp > 0 && p.quoteFreshness !== 'MARKET CLOSED') {
                  flashUpdates[sym] = p.ltp > prev ? 'up' : 'down';
                }
                previousPricesRef.current.set(sym, p.ltp);
              });

              if (Object.keys(flashUpdates).length > 0) {
                setPriceFlash((prev) => ({ ...prev, ...flashUpdates }));
                setTimeout(() => {
                  if (isMountedRef.current) {
                    setPriceFlash((prev) => {
                      const copy = { ...prev };
                      Object.keys(flashUpdates).forEach((k) => delete copy[k]);
                      return copy;
                    });
                  }
                }, 600);
              }

              setPositions(data.positions);
            }

            if (data.allPositions) setAllPositions(data.allPositions);
            if (data.squaredPositions) setSquaredPositions(data.squaredPositions);
          }
        } catch (e) {
          console.error('[LiveWS] Parse error:', e);
        }
      };

      ws.onerror = (err) => {
        if (!isMountedRef.current) return;
        console.warn('[LiveWS] Socket warning:', err);
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setIsConnected(false);
        setIsConnecting(false);

        // ✅ Reconnect with bounded exponential backoff (2s, 4s, 8s, max 16s)
        const delay = Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 16000);
        reconnectAttemptsRef.current += 1;

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connectWebSocket();
          }
        }, delay);
      };
    } catch (err) {
      if (isMountedRef.current) {
        setIsConnecting(false);
        setIsConnected(false);
        setError(err.message);
      }
    }
  }, [getUserId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadInitialSnapshot();
    connectWebSocket();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [loadInitialSnapshot, connectWebSocket]);

  // Send Stop Loss and Target update
  const updateSLTarget = useCallback((symbol, stopLoss, target) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'UPDATE_SL_TARGET',
          symbol,
          stopLoss,
          target,
        })
      );
    }
  }, []);

  // Trigger Sync
  const syncTrades = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SYNC_TRADES' }));
    }
    await loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  // ✅ Non-destructive manual refresh that retains existing position data
  const refresh = useCallback(async () => {
    await loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  return {
    isConnected,
    isConnecting,
    isMarketOpen,
    error,
    positions,
    allPositions,
    squaredPositions,
    portfolioSummary,
    lastTickTime,
    priceFlash,
    updateSLTarget,
    syncTrades,
    refresh,
    reconnect: connectWebSocket,
  };
}
