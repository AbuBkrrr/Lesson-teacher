import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { hydrateSession, setSessionExpiredHandler, login as apiLogin, deviceLink, signup as apiSignup, logout as apiLogout, redeemChildInvite as apiRedeemChildInvite } from '../api/client';
import { registerForPushNotifications, unregisterPushNotifications } from '../push';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // AsyncStorage is async, unlike localStorage on web — the app can't know
  // whether someone's logged in until this resolves, so the navigator
  // needs to wait on it rather than assume "no user yet" means logged out.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    hydrateSession().then(({ user: storedUser }) => {
      setUser(storedUser);
      setLoading(false);
      if (storedUser) registerForPushNotifications();
    });
  }, []);

  const login = useCallback(async (identifier, password) => {
    const data = await apiLogin(identifier, password);
    setUser(data.user);
    registerForPushNotifications();
    return data.user;
  }, []);

  const completeDeviceLink = useCallback(async (code, secret) => {
    const data = await deviceLink.claim(code, secret);
    if (!data) return null;
    setUser(data.user);
    registerForPushNotifications();
    return data.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await apiSignup(payload);
    setUser(data.user);
    registerForPushNotifications();
    return data.user;
  }, []);

  const redeemInvite = useCallback(async (code, username, password) => {
    const data = await apiRedeemChildInvite(code, username, password);
    setUser(data.user);
    registerForPushNotifications();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await unregisterPushNotifications();
    await apiLogout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, signup, logout, completeDeviceLink, redeemInvite }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
