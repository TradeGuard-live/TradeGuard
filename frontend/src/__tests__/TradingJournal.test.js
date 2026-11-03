import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TradingJournal from '../pages/TradingJournal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock auth context
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'trader1' },
    refreshBrokerStatus: jest.fn(),
  }),
}));

// Mock toast
const mockToast = { push: jest.fn() };
jest.mock('../components/Toast', () => ({
  useToast: () => mockToast,
}));

const mockEntry = {
  _id: 'j1',
  symbol: 'RELIANCE',
  direction: 'BUY',
  segment: 'EQUITY',
  strategy: 'Breakout',
  entryPrice: 2800,
  exitPrice: 2850,
  quantity: 10,
  netPnl: 450,
  status: 'PUBLISHED',
  preTrade: {
    whyEntering: '15m range breakout',
    plannedStopLoss: 2780,
    plannedTarget: 2860,
    plannedRiskReward: 3.0,
    confidenceLevel: 'HIGH'
  },
  postTrade: {
    whyExited: 'Hit target',
    followedPlan: true
  },
  psychology: {
    disciplineScore: 9,
    preTradeEmotions: ['Calm', 'Confident']
  },
  mistakes: []
};

const mockAnalytics = {
  totalEntries: 1,
  disciplineScore: 9.0,
  planAdherencePercent: 100,
  totalNetPnl: 450,
  winRate: 100,
  followedPlanStats: { count: 1, winRate: 100, netPnl: 450 },
  brokePlanStats: { count: 0, winRate: 0, netPnl: 0 },
  strategies: [
    { strategy: 'Breakout', trades: 1, wins: 1, losses: 0, winRate: 100, netPnl: 450, profitFactor: 99.99 }
  ],
  emotions: [
    { emotion: 'Calm', trades: 1, winRate: 100, netPnl: 450, avgDiscipline: 9.0 }
  ],
  mistakes: [],
  reviews: { weekly: [], monthly: [], yearly: [] }
};

// Mock API client
jest.mock('../api/client', () => ({
  api: {
    listJournalEntries: jest.fn(),
    getJournalAnalytics: jest.fn(),
    getJournalStrategies: jest.fn(),
    listTrades: jest.fn()
  }
}));

import { api } from '../api/client';

describe('Trading Journal Frontend Integration Tests', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    api.listJournalEntries.mockResolvedValue({
      success: true,
      count: 1,
      totalCount: 1,
      data: [mockEntry]
    });
    api.getJournalAnalytics.mockResolvedValue({
      success: true,
      data: mockAnalytics
    });
    api.getJournalStrategies.mockResolvedValue({
      success: true,
      data: ['Breakout', 'Pullback', 'Mean Reversion']
    });
    api.listTrades.mockResolvedValue({
      data: []
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    container = null;
    jest.clearAllMocks();
  });

  // ✅ Test 1: Sidebar contains "Trading Journal" navigation item pointing to /app/journal
  test('Sidebar renders Trading Journal link pointing to /app/journal', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/overview']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );
    });

    const journalLink = container.querySelector('a[href="/app/journal"]');
    expect(journalLink).toBeTruthy();
    expect(journalLink.textContent).toContain('Trading Journal');
  });

  // ✅ Test 2: Trading Journal renders KPI metrics, tabs, and journal log table
  test('TradingJournal renders top KPI metrics, tabs, and entry records', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/journal']}>
          <TradingJournal />
        </MemoryRouter>
      );
    });

    // Wait for state update
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(container.textContent).toContain('Trading Journal');
    expect(container.textContent).toContain('Trading Discipline Score');
    expect(container.textContent).toContain('Plan Adherence Rate');
    expect(container.textContent).toContain('RELIANCE');
    expect(container.textContent).toContain('Breakout');
  });

  // ✅ Test 3: Switching to Editor tab displays Pre-Trade and Post-Trade Review forms
  test('Clicking New Entry tab displays Pre-Trade and Post-Trade review sections', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/journal']}>
          <TradingJournal />
        </MemoryRouter>
      );
    });

    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const newEntryTab = Array.from(container.querySelectorAll('.tab')).find((tab) =>
      tab.textContent.includes('New Entry')
    );
    expect(newEntryTab).toBeTruthy();

    await act(async () => {
      newEntryTab.click();
    });

    // Check Pre-Trade section questions
    expect(container.textContent).toContain('Pre-Trade Review');
    expect(container.textContent).toContain('1. Why am I entering?');
    expect(container.textContent).toContain('2. What confirms the entry?');
    expect(container.textContent).toContain('3. Planned Stop-Loss');
    expect(container.textContent).toContain('4. Target Price');
    expect(container.textContent).toContain('5. Planned Risk / Reward');

    // Check Post-Trade section questions
    expect(container.textContent).toContain('Post-Trade Review');
    expect(container.textContent).toContain('1. Why did I exit?');
    expect(container.textContent).toContain('2. Did I follow my trading plan?');
    expect(container.textContent).toContain('3. Was my entry timing correct?');

    // Check Psychology & Mistake sections
    expect(container.textContent).toContain('Trading Psychology & Discipline Tracker');
    expect(container.textContent).toContain('Emotions Before the Trade');
    expect(container.textContent).toContain('Trading Mistake Tags');
    expect(container.textContent).toContain('Screenshots & Chart Attachments');
  });

  // ✅ Test 4: Strategy Performance tab renders strategy analytics
  test('Strategy tab renders strategy performance metrics', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/journal']}>
          <TradingJournal />
        </MemoryRouter>
      );
    });

    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const strategyTab = Array.from(container.querySelectorAll('.tab')).find((tab) =>
      tab.textContent.includes('Strategy Performance')
    );
    expect(strategyTab).toBeTruthy();

    await act(async () => {
      strategyTab.click();
    });

    expect(container.textContent).toContain('Trading Strategy Breakdown');
    expect(container.textContent).toContain('Profit Factor');
  });

  // ✅ Test 5: Mistake Tracker tab renders mistake tracking section
  test('Mistake Tracker tab renders trading mistakes section', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/journal']}>
          <TradingJournal />
        </MemoryRouter>
      );
    });

    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const mistakeTab = Array.from(container.querySelectorAll('.tab')).find((tab) =>
      tab.textContent.includes('Mistake Tracker')
    );
    expect(mistakeTab).toBeTruthy();

    await act(async () => {
      mistakeTab.click();
    });

    expect(container.textContent).toContain('Trading Mistakes & Behavioral Leaks');
  });
});
