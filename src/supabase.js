// OZIRA AI — Supabase client (Auth source of truth).
import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { config } from './config';
import { createSecureAuthStorage } from './supabaseAuthStorage';

const secureAuthStorage = createSecureAuthStorage(config.SUPABASE_AUTH_STORAGE_KEY);

// On iOS and Android, persist sessions in OS-backed secure storage. The Expo
// web preview uses Supabase's browser storage; it is not a mobile release target.
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
  auth: {
    storageKey: config.SUPABASE_AUTH_STORAGE_KEY,
    ...(Platform.OS === 'web' ? {} : { storage: secureAuthStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
