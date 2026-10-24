import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('tradeguard_theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);
      if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
        document.body.classList.add('light-theme');
        document.documentElement.style.colorScheme = 'light';
      } else {
        document.documentElement.classList.remove('light-theme');
        document.body.classList.remove('light-theme');
        document.documentElement.style.colorScheme = 'dark';
      }
      localStorage.setItem('tradeguard_theme', theme);
    } catch (e) {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: 'dark',
      setTheme: () => {},
      toggleTheme: () => {},
      isDark: true
    };
  }
  return context;
}

export default ThemeContext;
