import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/supabaseAuthStorage.js', import.meta.url), 'utf8');

function createStorage({ secureStore, asyncStorage, legacySessionKey = 'sb-project-auth-token' }) {
  const executable = source
    .replace(/^import \* as SecureStore from 'expo-secure-store';\r?\n/m, '')
    .replace(/^import AsyncStorage from '@react-native-async-storage\/async-storage';\r?\n/m, '')
    .replace('export { createSecureAuthStorage };', '');
  return new Function('SecureStore', 'AsyncStorage', 'legacySessionKey', `${executable}\nreturn createSecureAuthStorage(legacySessionKey);`)(secureStore, asyncStorage, legacySessionKey);
}

function secureStoreDouble(events = [], failSet = () => false) {
  const values = new Map();
  return {
    values,
    async getItemAsync(key) { events.push(['secure-read', key]); return values.has(key) ? values.get(key) : null; },
    async setItemAsync(key, value) {
      events.push(['secure-write', key, value]);
      if (failSet(key, value)) throw new Error('secure write failed');
      values.set(key, value);
    },
    async deleteItemAsync(key) { events.push(['secure-delete', key]); values.delete(key); },
  };
}

test('native session restore retires only the exact legacy key before reading the committed secure value', async () => {
  const events = [];
  let releaseRemoval;
  const legacySessionKey = 'sb-gdydxlmidnshluvpynml-auth-token';
  const secure = secureStoreDouble(events);
  const storage = createStorage({
    asyncStorage: { removeItem: key => { events.push(['legacy-remove', key]); return new Promise(resolve => { releaseRemoval = resolve; }); } },
    secureStore: secure,
    legacySessionKey,
  });
  await storage.setItem(legacySessionKey, 'secure-session');
  events.length = 0;

  const first = storage.getItem(legacySessionKey);
  const second = storage.getItem(legacySessionKey);
  await Promise.resolve();
  assert.deepEqual(events, [['legacy-remove', legacySessionKey]]);
  releaseRemoval();
  assert.deepEqual(await Promise.all([first, second]), ['secure-session', 'secure-session']);
  assert.equal(events.filter(event => event[0] === 'legacy-remove').length, 1);
});

test('legacy cleanup failure blocks session restore and never falls back to AsyncStorage', async () => {
  let secureReads = 0;
  const storage = createStorage({
    asyncStorage: { async removeItem() { throw new Error('legacy store unavailable'); } },
    secureStore: {
      async getItemAsync() { secureReads += 1; return null; },
      async setItemAsync() {},
      async deleteItemAsync() {},
    },
  });

  await assert.rejects(storage.getItem('sb-project-auth-token'), /legacy store unavailable/);
  assert.equal(secureReads, 0);
});

test('unrelated storage keys never trigger legacy AsyncStorage deletion', async () => {
  const events = [];
  const storage = createStorage({
    asyncStorage: { async removeItem(key) { events.push(['legacy-remove', key]); } },
    secureStore: secureStoreDouble(events),
    legacySessionKey: 'sb-gdydxlmidnshluvpynml-auth-token',
  });

  assert.equal(await storage.getItem('ozira-conversation-cache'), null);
  assert.deepEqual(events, [['secure-read', 'ozira-conversation-cache::ozira-secure-manifest']]);
});

test('session writes and logout deletion stay in SecureStore and remove the committed generation', async () => {
  const events = [];
  const secure = secureStoreDouble(events);
  const legacySessionKey = 'sb-project-auth-token';
  const storage = createStorage({
    asyncStorage: { async removeItem(key) { events.push(['legacy-remove', key]); } },
    secureStore: secure,
    legacySessionKey,
  });

  await storage.setItem(legacySessionKey, 'new-session');
  await storage.removeItem(legacySessionKey);
  assert.equal(secure.values.size, 0);
  assert.ok(events.some(event => event[0] === 'secure-write' && event[1].includes('::ozira-secure::')));
  assert.ok(events.some(event => event[0] === 'secure-delete' && event[1].endsWith('::ozira-secure-manifest')));
  assert.deepEqual(events.filter(event => event[0] === 'legacy-remove'), [['legacy-remove', legacySessionKey]]);
});

test('large Unicode sessions are safely chunked and restored without exceeding SecureStore item guidance', async () => {
  const events = [];
  const secure = secureStoreDouble(events);
  const storage = createStorage({
    asyncStorage: { async removeItem() {} },
    secureStore: secure,
    legacySessionKey: 'legacy-auth-key',
  });
  const session = JSON.stringify({ access_token: 'x'.repeat(6000), user_metadata: { display_name: '🧁'.repeat(900) } });
  await storage.setItem('auth-key', session);

  const manifest = JSON.parse(secure.values.get('auth-key::ozira-secure-manifest'));
  const chunks = Array.from({ length: manifest.count }, (_, index) => secure.values.get(`auth-key::ozira-secure::${manifest.generation}::${index}`));
  assert.ok(manifest.count > 1);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 1700));
  assert.equal(await storage.getItem('auth-key'), session);
});

test('a failed new generation leaves the prior committed session readable', async () => {
  const events = [];
  let shouldFail = false;
  const secure = secureStoreDouble(events, (key) => {
    if (shouldFail && key.includes('::ozira-secure::')) { shouldFail = false; return true; }
    return false;
  });
  const storage = createStorage({
    asyncStorage: { async removeItem() {} },
    secureStore: secure,
    legacySessionKey: 'legacy-auth-key',
  });

  await storage.setItem('auth-key', 'old-session');
  shouldFail = true;
  await assert.rejects(storage.setItem('auth-key', 'replacement-session'), /secure write failed/);
  assert.equal(await storage.getItem('auth-key'), 'old-session');
});

test('invalid or incomplete manifests fail closed instead of returning a partial session', async () => {
  const values = new Map([['auth-key::ozira-secure-manifest', JSON.stringify({ version: 1, generation: 'g', count: 2 })]]);
  const storage = createStorage({
    asyncStorage: { async removeItem() {} },
    secureStore: {
      async getItemAsync(key) { return values.get(key) ?? null; },
      async setItemAsync(key, value) { values.set(key, value); },
      async deleteItemAsync(key) { values.delete(key); },
    },
    legacySessionKey: 'legacy-auth-key',
  });
  await assert.rejects(storage.getItem('auth-key'), /incomplete/);
});
