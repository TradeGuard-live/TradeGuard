import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BrokerAccountForm from '../pages/BrokerAccountForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock auth context
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'trader1' },
    refreshBrokerStatus: jest.fn(),
  }),
}));

// Mock toast
jest.mock('../components/Toast', () => ({
  useToast: () => ({
    push: jest.fn(),
  }),
}));

// Mock api client
jest.mock('../api/client', () => ({
  api: {
    getBrokerAccount: jest.fn().mockResolvedValue({
      data: {
        broker: 'ANGEL_ONE',
        credentials: { clientId: 'A10099' },
        isActive: true,
      },
    }),
    createBrokerAccount: jest.fn().mockResolvedValue({ message: 'Created' }),
    updateBrokerAccount: jest.fn().mockResolvedValue({ message: 'Updated' }),
  },
}));

describe('Project Logo Clickable & Broker Credentials Input Tests', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    container = null;
  });

  test('Sidebar renders project logo and brand name inside a clickable Link pointing to /app/overview', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/trades']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );
    });

    const brandLink = container.querySelector('#sidebar-logo-brand');
    expect(brandLink).toBeTruthy();
    expect(brandLink.getAttribute('href')).toBe('/app/overview');
    expect(brandLink.textContent).toContain('TradeGuard');
    expect(brandLink.querySelector('.sidebar-logo')).toBeTruthy();
  });

  test('Sidebar in collapsed mode still provides clickable project logo pointing to /app/overview', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/trades']}>
          <Sidebar collapsed={true} onToggle={() => {}} />
        </MemoryRouter>
      );
    });

    const brandLink = container.querySelector('#sidebar-logo-brand');
    expect(brandLink).toBeTruthy();
    expect(brandLink.getAttribute('href')).toBe('/app/overview');
    expect(brandLink.querySelector('.sidebar-logo')).toBeTruthy();
  });

  test('Broker credentials SecretField retains DOM element and accepts 6-character inputs without unmounting or dropping input', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/broker-accounts/new']}>
          <BrokerAccountForm />
        </MemoryRouter>
      );
    });

    // Default broker is UPSTOX, let's switch broker to ANGEL_ONE to test MPIN and TOTP
    const select = container.querySelector('select.form-select');
    expect(select).toBeTruthy();

    act(() => {
      select.value = 'ANGEL_ONE';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Find the MPIN password input
    const mpinInput = container.querySelector('#secret-password');
    expect(mpinInput).toBeTruthy();
    expect(mpinInput.type).toBe('password');

    // Focus the element
    mpinInput.focus();
    expect(document.activeElement).toBe(mpinInput);

    // Enter letters sequentially: simulates typing 6 characters '123456'
    const characters = ['1', '2', '3', '4', '5', '6'];
    let accumulated = '';
    for (const char of characters) {
      accumulated += char;
      const initialNode = mpinInput;
      act(() => {
        mpinInput.value = accumulated;
        mpinInput.dispatchEvent(new Event('input', { bubbles: true }));
        mpinInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // The node in DOM must be identical (not destroyed/re-created by component remounting)
      const currentNode = container.querySelector('#secret-password');
      expect(currentNode).toBe(initialNode);
      expect(currentNode.value).toBe(accumulated);
    }

    expect(mpinInput.value).toBe('123456');

    // Test eye toggle button reveals password
    const toggleBtn = mpinInput.parentElement.querySelector('.input-icon-btn');
    expect(toggleBtn).toBeTruthy();

    act(() => {
      toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('#secret-password').type).toBe('text');

    act(() => {
      toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('#secret-password').type).toBe('password');
  });

  test('TOTP secret key field also accepts 6+ characters continuously', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/broker-accounts/new']}>
          <BrokerAccountForm />
        </MemoryRouter>
      );
    });

    const select = container.querySelector('select.form-select');
    act(() => {
      select.value = 'ANGEL_ONE';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const totpInput = container.querySelector('#secret-totpSecret');
    expect(totpInput).toBeTruthy();

    // Type a 6-digit TOTP code
    act(() => {
      totpInput.value = '987654';
      totpInput.dispatchEvent(new Event('input', { bubbles: true }));
      totpInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(totpInput.value).toBe('987654');
  });

  test('Connect Broker Account page includes Kotak Neo option in dropdown and renders Kotak Neo fields', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/app/broker-accounts/new']}>
          <BrokerAccountForm />
        </MemoryRouter>
      );
    });

    const select = container.querySelector('select.form-select');
    expect(select).toBeTruthy();

    // Verify KOTAK_NEO option exists
    const kotakOption = Array.from(select.options).find((opt) => opt.value === 'KOTAK_NEO');
    expect(kotakOption).toBeTruthy();
    expect(kotakOption.textContent).toBe('Kotak Neo');

    // Select KOTAK_NEO
    act(() => {
      select.value = 'KOTAK_NEO';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Check Kotak Neo specific instructions and fields
    expect(container.textContent).toContain('Kotak Neo Connection Instructions');
    expect(container.querySelector('#field-mobileNumber')).toBeTruthy();
    expect(container.querySelector('#secret-password')).toBeTruthy();
    expect(container.querySelector('#secret-totpSecret')).toBeTruthy();
    expect(container.querySelector('#secret-apiKey')).toBeTruthy();
  });
});
