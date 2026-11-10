// OZIRA AI — auth state, backed by Supabase Auth.
// The `token` here is Supabase's access token; the backend verifies it.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { api, absUrl, setToken } from '../api';
import { getProfile as getLocalProfile, getProfileOwnerId, replaceProfile as replaceLocalProfile, setConversationOwner } from '../localStore';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [token, setTok] = useState(null);
  const [user, setUser] = useState(null);       // { id, email, ...profile }
  const [loading, setLoading] = useState(true);
  const activeOwner = useRef(null);
  const authRevision = useRef(0);
  const [ownerId, setOwnerId] = useState(null);

  // Load the profile row for the signed-in user.
  async function loadProfile(session) {
    if (!session) { setUser(null); return; }
    const authUser = session.user;
    const current = () => activeOwner.current === authUser.id;
    let profile = {};
    try {
      const { data } = await supabase
        .from('profiles').select('*').eq('id', authUser.id).single();
      if (data) profile = data;
    } catch (_) {}
    try {
      if (!current()) return;
      const local = await getLocalProfile();
      const localOwnerId = await getProfileOwnerId();
      if (!current()) return;
      const result = await api.profile(session.access_token);
      let accountProfile = result.profile || {};
      // One-time migration: profiles saved by older mobile builds only exist
      // in the phone cache. Upload them when the account has no durable copy.
      const belongsToThisAccount = localOwnerId === authUser.id;
      const hasOldLocalProfile = belongsToThisAccount && Object.keys(local || {}).some(key => key !== 'horoscope');
      if (!current()) return;
      if (!accountProfile.updatedAt && hasOldLocalProfile) {
        const migrated = await api.saveProfile({ ...local, ...accountProfile }, session.access_token);
        accountProfile = migrated.profile || accountProfile;
      }
      if (accountProfile.avatar) accountProfile.avatar = absUrl(accountProfile.avatar);
      if (!current()) return;
      await replaceLocalProfile(accountProfile, authUser.id);
      profile = { ...profile, ...accountProfile };
    } catch (_) {}
    if (!current()) return;
    setUser({ id: authUser.id, email: authUser.email, ...profile });
  }

  useEffect(() => {
    // 1) Restore any existing session on boot. Never let a slow profile fetch
    // block the app on the loading spinner — resolve loading first, then load
    // the profile in the background.
    (async () => {
      try {
        const revision = authRevision.current;
        const { data: { session } } = await supabase.auth.getSession();
        if (revision !== authRevision.current) return;
        if (session) { if (activeOwner.current !== session.user.id) setUser(null); setOwnerId(session.user.id); activeOwner.current = session.user.id; setConversationOwner(session.user.id); setToken(session.access_token); setTok(session.access_token); loadProfile(session); }
      } catch (_) {}
      setLoading(false);
    })();

    // 2) React to sign-in / sign-out / token-refresh.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      authRevision.current += 1;
      setLoading(false);
      if (session) { if (activeOwner.current !== session.user.id) setUser(null); setOwnerId(session.user.id); activeOwner.current = session.user.id; setConversationOwner(session.user.id); setToken(session.access_token); setTok(session.access_token); await loadProfile(session); }
      else { setOwnerId(null); activeOwner.current = null; setConversationOwner(null); setToken(null); setTok(null); setUser(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  const signUp = async (name, email, password, lang, gender) => {
    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { name, lang: lang || 'en', gender: gender || '' } },
    });
    if (error) throw new Error(error.message);
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  // --- Password reset (email OTP code, then set a new password) ---
  // 1) Send a 6-digit code to the email.
  const sendResetCode = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: false },
    });
    if (error) throw new Error(error.message);
  };
  // 2) Verify the code (this signs the user in), then set the new password.
  const resetPassword = async (email, code, newPassword) => {
    const { error: vErr } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (vErr) throw new Error(vErr.message);
    const { error: uErr } = await supabase.auth.updateUser({ password: newPassword });
    if (uErr) throw new Error(uErr.message);
  };

  // Re-fetch the profile row (after edits on the Profile screen, etc.)
  const refresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await loadProfile(session);
  };

  // Update the shared account profile used by mobile and web.
  const updateProfile = async (patch) => {
    if (!user?.id) return;
    const result = await api.saveProfile(patch, token);
    const saved = { ...(result.profile || {}) };
    if (saved.avatar) saved.avatar = absUrl(saved.avatar);
    await replaceLocalProfile(saved, user.id);
    setUser(current => ({ ...(current || {}), ...saved }));
    return saved;
  };

  return (
    <AuthContext.Provider value={{ token, user, ownerId, loading, signIn, signUp, signOut, refresh, updateProfile, sendResetCode, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
