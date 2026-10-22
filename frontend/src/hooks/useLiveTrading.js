import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_URL, api } from '../api/client';

export function useLiveTrading() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState(null);

  const [positions, setPositions] = useState([]);
  const [allPositions, setAllPositions] = useState([]);
  const [squaredPositions, setSquaredPositions] = useState([]);

  const [portfolioSummary, setPortfolioSummary] = useState({
    totalGrossPnL: 0,
    totalUnrealizedPnL: 0,
    totalRealizedPnL: 0,
    totalNetPnL: 0,
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
  const isMountedRef = useRef(true);

  // Retrieve current user ID
  const getUserId = useCallback(() => {
    try {
      const user = JSON.parse(localStorage.getItem('tg_user') || 'null');
      return user?.userId || user?.id || user?._id || '6aba05ee5724ee5fded23bc7';
    } catch {
      return '6aba05ee5724ee5fded23bc7';
    }
  }, []);

  // Fetch initial HTTP snapshot
  const loadInitialSnapshot = useCallback(async () => {
    try {
      const userId = getUserId();
      const res = await api.liveTradingSummary(userId);
      if (res?.data && isMountedRef.current) {
        if (res.data.positions) setPositions(res.data.positions);
        if (res.data.portfolioSummary) setPortfolioSummary(res.data.portfolioSummary);
        if (res.data.allPositions) setAllPositions(res.data.allPositions);
        if (res.data.squaredPositions) setSquaredPositions(res.data.squaredPositions);
      }
    } catch (err) {
      console.warn('Could not load initial snapshot via HTTP:', err.message);
    }
  }, [getUserId]);

  // Connect to WebSocket
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

        // Authenticate with user ID
        const userId = getUserId();
        ws.send(JSON.stringify({ type: 'AUTH', userId }));
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'INITIAL_DATA' || payload.type === 'LIVE_PNL_UPDATE') {
            const data = payload.data;
            if (!data) return;

            setLastTickTime(Date.now());

            if (data.portfolioSummary) {
              setPortfolioSummary(data.portfolioSummary);
            }

            if (Array.isArray(data.positions)) {
              // Calculate price flash (up/down tick)
              const flashUpdates = {};
              data.positions.forEach((p) => {
                const sym = p.symbol || p.instrumentToken;
                const prev = previousPricesRef.current.get(sym);
                if (prev !== undefined && p.ltp !== prev) {
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

        // Schedule auto-reconnect in 3 seconds
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connectWebSocket();
          }
        }, 3000);
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

  return {
    isConnected,
    isConnecting,
    error,
    positions,
    allPositions,
    squaredPositions,
    portfolioSummary,
    lastTickTime,
    priceFlash,
    updateSLTarget,
    syncTrades,
    reconnect: connectWebSocket,
  };
}
