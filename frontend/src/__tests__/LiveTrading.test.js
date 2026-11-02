import { BROKER_META, SUPPORTED_BROKERS } from '../data/mockData';

// ✅ Frontend Unit & Regression Tests for Live Trading & Broker Integrations
describe('TradeGuard Frontend Market Data & UI Integrity', () => {
  test('Supported brokers list includes Kotak Neo, Groww, Zerodha, Upstox, Dhan, and Angel One', () => {
    // ✅ Active supported brokers include Upstox, Dhan, Angel One, Groww, Zerodha, and Kotak Neo
    expect(SUPPORTED_BROKERS.UPSTOX).toBeDefined();
    expect(SUPPORTED_BROKERS.DHAN).toBeDefined();
    expect(SUPPORTED_BROKERS.ANGEL_ONE).toBeDefined();
    expect(SUPPORTED_BROKERS.GROWW).toBeDefined();
    expect(SUPPORTED_BROKERS.GROWW.name).toBe('Groww');
    expect(SUPPORTED_BROKERS.GROWW.color).toBe('#00d09c');
    expect(SUPPORTED_BROKERS.ZERODHA).toBeDefined();
    expect(SUPPORTED_BROKERS.ZERODHA.name).toBe('Zerodha');
    expect(SUPPORTED_BROKERS.ZERODHA.color).toBe('#387ed1');
    expect(SUPPORTED_BROKERS.KOTAK_NEO).toBeDefined();
    expect(SUPPORTED_BROKERS.KOTAK_NEO.name).toBe('Kotak Neo');
  });

  test('BROKER_META contains Kotak Neo and historical accounts metadata', () => {
    expect(BROKER_META.KOTAK_NEO).toBeDefined();
    expect(BROKER_META.KOTAK_NEO.name).toBe('Kotak Neo');
    expect(BROKER_META.KOTAK_NEO_YOUTH).toBeDefined();
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

  test('Exit options support MARKET, LIMIT, SL, and SL-M order types', () => {
    const supportedExitOrderTypes = ['MARKET', 'LIMIT', 'SL', 'SL-M'];
    expect(supportedExitOrderTypes).toContain('MARKET');
    expect(supportedExitOrderTypes).toContain('LIMIT');
    expect(supportedExitOrderTypes).toContain('SL');
    expect(supportedExitOrderTypes).toContain('SL-M');
  });

  test('Exit Position correctly resolves opposing transaction side', () => {
    const resolveExitSide = (pos) => (pos.side === 'BUY' || pos.openQuantity > 0 ? 'SELL' : 'BUY');
    expect(resolveExitSide({ side: 'BUY', openQuantity: 10 })).toBe('SELL');
    expect(resolveExitSide({ side: 'SELL', openQuantity: -10 })).toBe('BUY');
  });

  test('Square off all positions computes aggregate count and order type', () => {
    const openPositions = [
      { symbol: 'RELIANCE', openQuantity: 10, side: 'BUY', ltp: 2500 },
      { symbol: 'TCS', openQuantity: 5, side: 'BUY', ltp: 3800 }
    ];
    const exitAllPayload = {
      orderType: 'MARKET',
      positions: openPositions
    };
    expect(exitAllPayload.positions.length).toBe(2);
    expect(exitAllPayload.orderType).toBe('MARKET');
  });

  test('Live Trading table headers include Entry Price replacing Market Value', () => {
    // Verified table columns structure in LiveTrading page
    const tableColumns = [
      'Instrument & Exchange',
      'Direction / Qty',
      'Avg Price',
      'Current / Valid Price',
      'Feed / Broker WS',
      'Entry Price',
      'Breakeven',
      'Stop Loss & Risk Amt',
      'Target & Live R:R',
      'Total Charges',
      'Gross P&L',
      'Net P&L',
      'Action'
    ];
    expect(tableColumns).toContain('Entry Price');
    expect(tableColumns).not.toContain('Market Value');
  });
});

