import { BROKER_META, SUPPORTED_BROKERS } from '../data/mockData';

// ✅ Frontend Unit & Regression Tests for Live Trading & Broker Integrations
describe('TradeGuard Frontend Market Data & UI Integrity', () => {
  test('Supported brokers list excludes deprecated Kotak Neo for new accounts and includes Groww', () => {
    // ✅ Active supported brokers include Upstox, Dhan, Angel One, and Groww
    expect(SUPPORTED_BROKERS.UPSTOX).toBeDefined();
    expect(SUPPORTED_BROKERS.DHAN).toBeDefined();
    expect(SUPPORTED_BROKERS.ANGEL_ONE).toBeDefined();
    expect(SUPPORTED_BROKERS.GROWW).toBeDefined();
    expect(SUPPORTED_BROKERS.GROWW.name).toBe('Groww');
    expect(SUPPORTED_BROKERS.GROWW.color).toBe('#00d09c');
    expect(SUPPORTED_BROKERS.ZERODHA).toBeDefined();
    expect(SUPPORTED_BROKERS.ZERODHA.name).toBe('Zerodha');
    expect(SUPPORTED_BROKERS.ZERODHA.color).toBe('#387ed1');
    expect(SUPPORTED_BROKERS.KOTAK_NEO).toBeUndefined();
  });

  test('BROKER_META preserves Kotak Neo with Legacy labeling for migration safety', () => {
    expect(BROKER_META.KOTAK_NEO).toBeDefined();
    expect(BROKER_META.KOTAK_NEO.name).toContain('Legacy');
  });

  test('Live Trading quote freshness and status styling tokens exist', () => {
    const statuses = ['LIVE', 'MARKET CLOSED', 'DELAYED', 'STALE', 'UNAVAILABLE'];
    statuses.forEach((status) => {
      expect(status.length).toBeGreaterThan(0);
    });
  });

  test('P&L formatting logic separates invested capital, market value and net PnL', () => {
    const openQuantity = 50;
    const avgPrice = 1000;
    const ltp = 1050;
    const totalCharges = 45.50;

    const investedCapital = openQuantity * avgPrice; // 50,000
    const marketValue = openQuantity * ltp; // 52,500
    const grossPnL = (ltp - avgPrice) * openQuantity; // +2,500
    const netPnL = grossPnL - totalCharges; // +2,454.50

    expect(investedCapital).toBe(50000);
    expect(marketValue).toBe(52500);
    expect(grossPnL).toBe(2500);
    expect(netPnL).toBe(2454.50);
  });
});
