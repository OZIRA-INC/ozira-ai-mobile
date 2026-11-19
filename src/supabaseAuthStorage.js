// Supabase native sessions live in OS-backed SecureStore. Values are chunked
// because session JSON can exceed SecureStore's per-item size guidance.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHUNK_BYTES = 1700;
const MAX_CHUNKS = 32;
const STORAGE_VERSION = 1;
let generationCounter = 0;

function utf8Length(codePoint) {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function splitUtf8(value) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of value) {
    const size = utf8Length(character.codePointAt(0));
    if (bytes + size > CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

function createSecureAuthStorage(legacySessionKey) {
  const legacyMigrationByKey = new Map();
  const writeQueueByKey = new Map();

  function manifestKey(key) {
    return `${key}::ozira-secure-manifest`;
  }

  function logoutTombstoneKey(key) {
    return `${key}::ozira-secure-logout`;
  }

  function partKey(key, generation, index) {
    return `${key}::ozira-secure::${generation}::${index}`;
  }

  function parseManifest(value) {
    if (typeof value !== 'string') return null;
    try {
      const manifest = JSON.parse(value);
      if (manifest.version !== STORAGE_VERSION
        || typeof manifest.generation !== 'string'
        || !Number.isInteger(manifest.count)
        || manifest.count < 1
        || manifest.count > MAX_CHUNKS) return null;
      return manifest;
    } catch (_) {
      return null;
    }
  }

  async function ensureLegacySessionMigrated(key) {
    if (key !== legacySessionKey) return;
    let migration = legacyMigrationByKey.get(key);
    if (!migration) {
      migration = enqueueWrite(key, async () => {
        const pointer = manifestKey(key);
        const rawManifest = await SecureStore.getItemAsync(pointer);
        if (rawManifest !== null) {
          if (!parseManifest(rawManifest)) throw new Error('Stored auth session metadata is invalid.');
          // A committed SecureStore generation wins over a stale legacy copy.
          await AsyncStorage.removeItem(key);
          return;
        }

        // A logout tombstone prevents failed cleanup from restoring an old session.
        if (await SecureStore.getItemAsync(logoutTombstoneKey(key)) !== null) {
          await AsyncStorage.removeItem(key);
          return;
        }

        const legacyValue = await AsyncStorage.getItem(key);
        if (legacyValue === null || legacyValue === undefined) return;
        if (typeof legacyValue !== 'string') throw new TypeError('Legacy auth storage values must be strings.');

        // Keep the legacy value until every secure chunk and the manifest commit.
        await writeItem(key, legacyValue);
        await AsyncStorage.removeItem(key);
      });
      legacyMigrationByKey.set(key, migration);
    }
    try {
      await migration;
    } catch (error) {
      throw error;
    } finally {
      if (legacyMigrationByKey.get(key) === migration) legacyMigrationByKey.delete(key);
    }
  }

  function enqueueWrite(key, operation) {
    const previous = writeQueueByKey.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    writeQueueByKey.set(key, current);
    return current.finally(() => {
      if (writeQueueByKey.get(key) === current) writeQueueByKey.delete(key);
    });
  }

  async function removeGeneration(key, manifest) {
    if (!manifest) return;
    await Promise.all(Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.deleteItemAsync(partKey(key, manifest.generation, index))));
  }

  async function writeItem(key, value) {
    if (typeof value !== 'string') throw new TypeError('Supabase auth storage values must be strings.');
    const chunks = splitUtf8(value);
    if (chunks.length > MAX_CHUNKS) throw new Error('Auth session exceeds secure storage capacity.');

    const pointer = manifestKey(key);
    const previous = parseManifest(await SecureStore.getItemAsync(pointer));
    const generation = `${Date.now().toString(36)}-${(++generationCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        await SecureStore.setItemAsync(partKey(key, generation, index), chunks[index]);
      }
      // Readers switch to this generation only after every chunk is written.
      await SecureStore.setItemAsync(pointer, JSON.stringify({ version: STORAGE_VERSION, generation, count: chunks.length }));
    } catch (error) {
      await removeGeneration(key, { generation, count: chunks.length }).catch(() => {});
      throw error;
    }

    // A committed new session supersedes a logout tombstone. The manifest
    // remains authoritative if tombstone cleanup itself fails.
    await SecureStore.deleteItemAsync(logoutTombstoneKey(key)).catch(() => {});

    if (previous && previous.generation !== generation) await removeGeneration(key, previous);
  }

  return Object.freeze({
    getItem: async key => {
      await ensureLegacySessionMigrated(key);
      const pointer = manifestKey(key);
      const rawManifest = await SecureStore.getItemAsync(pointer);
      if (rawManifest === null) return null;
      const manifest = parseManifest(rawManifest);
      if (!manifest) throw new Error('Stored auth session metadata is invalid.');
      const chunks = await Promise.all(Array.from({ length: manifest.count }, (_, index) =>
        SecureStore.getItemAsync(partKey(key, manifest.generation, index))));
      if (chunks.some(chunk => typeof chunk !== 'string')) {
        throw new Error('Stored auth session is incomplete.');
      }
      return chunks.join('');
    },
    setItem: (key, value) => enqueueWrite(key, () => writeItem(key, value)),
    removeItem: key => enqueueWrite(key, async () => {
      const pointer = manifestKey(key);
      // Commit logout before deleting the secure pointer or legacy copy.
      await SecureStore.setItemAsync(logoutTombstoneKey(key), '1');
      const previous = parseManifest(await SecureStore.getItemAsync(pointer));
      // Remove the pointer first: interrupted cleanup cannot restore a session.
      await SecureStore.deleteItemAsync(pointer);
      await removeGeneration(key, previous);
      if (key === legacySessionKey) await AsyncStorage.removeItem(key);
    }),
  });
}

export { createSecureAuthStorage };
