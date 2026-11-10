import React, { createContext, useContext, useState, useCallback } from 'react';
import { getStoredUser, login as apiLogin, logout as apiLogout, signup as apiSignup } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);

  const login = useCallback(async (identifier, password) => {
    const data = await apiLogin(identifier, password);
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await apiSignup(payload);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  // For flows that already call storeSession themselves (e.g. child
  // invite redemption) and just need AuthContext's user state to catch up.
  const setUserFromSession = useCallback((sessionUser) => {
    setUser(sessionUser);
  }, []);

  return <AuthContext.Provider value={{ user, login, signup, logout, setUserFromSession }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
