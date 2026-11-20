// Build-time environment is explicit. There is deliberately no production fallback.
const profiles = {
  staging: {
    apiBase: 'https://ozira-ai-staging-staging.up.railway.app',
    supabaseProjectId: 'gdydxlmidnshluvpynml',
  },
  production: {
    apiBase: 'https://ozira-ai-production.up.railway.app',
    supabaseProjectId: 'gmdsprtbbqnjubbpytfc',
  },
};

const environment = process.env.EXPO_PUBLIC_OZIRA_ENV;
const profile = profiles[environment];
if (!profile) throw new Error('Set EXPO_PUBLIC_OZIRA_ENV to an explicitly configured OZIRA environment.');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const expectedSupabaseUrl = `https://${profile.supabaseProjectId}.supabase.co`;
if (supabaseUrl !== expectedSupabaseUrl) {
  throw new Error(`Supabase URL does not match the selected ${environment} environment.`);
}
if (typeof supabasePublishableKey !== 'string' || !supabasePublishableKey.startsWith('sb_publishable_')) {
  throw new Error('A Supabase publishable client key is required; secret keys are not accepted.');
}

export const appEnvironment = environment;
export const config = Object.freeze({
  API_BASE: profile.apiBase,
  SUPABASE_URL: expectedSupabaseUrl,
  SUPABASE_ANON_KEY: supabasePublishableKey,
  SUPABASE_AUTH_STORAGE_KEY: `sb-${profile.supabaseProjectId}-auth-token`,
  SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
});
