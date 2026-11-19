# Mobile Staging and Session Security

## Environment selection

Mobile builds require `EXPO_PUBLIC_OZIRA_ENV` to be exactly `staging` or
`production`; absence and unknown values fail app configuration. The
`development`, `preview`, and `staging` EAS profiles select Staging. Staging
uses the fixed Staging Railway API and requires `EXPO_PUBLIC_SUPABASE_URL` to
match project `gdydxlmidnshluvpynml`. The production profile preserves the
existing Production application identifiers and requires the Production
Supabase project `gmdsprtbbqnjubbpytfc`.

`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is a public client key, not a server
credential. Supply the appropriate key through the corresponding EAS build
environment; no key is stored in source. The app rejects secret-key prefixes.
This patch does not create or edit EAS environment variables, build an app, or
contact either hosted project. Staging and Production identifiers are separate
so installing a Staging build cannot replace the Production app.

Before an authorized Staging build, the EAS `preview` environment must contain
the Staging Supabase URL and publishable key. A missing or mismatched value
fails closed. Production remains NO-GO; a Production build or distribution
requires separate authorization.

## Session storage change

Native Supabase sessions now use Expo SecureStore, backed by iOS Keychain and
Android Keystore-protected storage. Web preview continues using Supabase's
browser storage. On native session restore, the adapter removes only the exact
project-scoped Supabase auth key from legacy AsyncStorage before reading
SecureStore. Session strings are UTF-8 chunked below SecureStore's documented
per-value guidance and committed by writing a versioned manifest last. A failed
partial write cannot replace the previous complete session; invalid or missing
chunks fail closed. Logout removes the manifest before its fragments so an
interrupted deletion cannot restore the session. The migration does not copy the
old token or clear other app data. If targeted legacy cleanup fails, auth
storage restoration fails closed. All existing accounts must sign in again once
after installing the secure-storage update. This behavior was explicitly chosen
for OZIRA account-session remediation.

Conversation cache behavior remains account-scoped by the existing PR #2
implementation. It is separate from authentication secrets and is not claimed
to be encrypted at rest by this change.
