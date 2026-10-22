import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [brokerAccounts, setBrokerAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('tg_token');
    const storedUser = localStorage.getItem('tg_user');
    const storedAccounts = localStorage.getItem('tg_broker_accounts');
    if (storedToken && storedUser) {
      setToken(storedToken);
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('tg_user');
      }
    }
    if (storedAccounts) {
      try {
        setBrokerAccounts(JSON.parse(storedAccounts));
      } catch {
        localStorage.removeItem('tg_broker_accounts');
      }
    }
    setLoading(false);
  }, []);

  const refreshBrokerStatus = useCallback(async () => {
    try {
      const res = await api.listBrokerAccounts();
      const accounts = Array.isArray(res?.data) ? res.data : [];
      setBrokerAccounts(accounts);
      localStorage.setItem('tg_broker_accounts', JSON.stringify(accounts));
      return accounts;
    } catch (e) {
      return [];
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    localStorage.setItem('tg_token', data.token);
    const normalizedUser = {
      id: data.user._id || data.user.id,
      userId: data.user._id || data.user.id,
      username: data.user.username,
      email: data.user.email,
    };
    localStorage.setItem('tg_user', JSON.stringify(normalizedUser));
    if (Array.isArray(data.brokerAccounts)) {
      setBrokerAccounts(data.brokerAccounts);
      localStorage.setItem('tg_broker_accounts', JSON.stringify(data.brokerAccounts));
    }
    setToken(data.token);
    setUser(normalizedUser);
    return normalizedUser;
  }, []);

  const register = useCallback(async (username, email, password) => {
    const data = await api.register(username, email, password);
    localStorage.setItem('tg_token', data.token);
    const normalizedUser = {
      id: data.user._id || data.user.id,
      userId: data.user._id || data.user.id,
      username: data.user.username,
      email: data.user.email,
    };
    localStorage.setItem('tg_user', JSON.stringify(normalizedUser));
    setToken(data.token);
    setUser(normalizedUser);
    return normalizedUser;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('tg_token');
    localStorage.removeItem('tg_user');
    localStorage.removeItem('tg_broker_accounts');
    setToken(null);
    setUser(null);
    setBrokerAccounts([]);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        brokerAccounts,
        refreshBrokerStatus,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!token
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}