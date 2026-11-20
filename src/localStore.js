// Chat history and folders live on the account, not on the device, so the same
// chats appear in the mobile app and on the web. This file keeps the API it had
// when everything was local — the screens call exactly the same functions — but
// the conversation and folder ones now go through the server.
//
// The on-device file is still written on every successful call, demoted from
// source of truth to a read cache: with no network the app shows the last known
// list instead of an empty screen. Theme and settings stay local. Profile is
// also cached here for instant display, but its source of truth is the account
// API so it follows the user to web and other phones.
import { Paths, File } from 'expo-file-system';
import { api } from './api';
import { config } from './config';
import { conversationMessage, projectReference } from './conversationContract';

let cache = null;
let accountOwner = null;
let accountEpoch = 0;
// A cache belongs to an authenticated account, never to the last phone user.
// Unowned legacy conversation files are deliberately not auto-migrated.
export function setConversationOwner(ownerId) {
  const next = typeof ownerId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(ownerId) ? ownerId : null;
  if (next === accountOwner) return;
  accountOwner = next;
  accountEpoch += 1;
  cache = null;
}
// Synchronous lease invalidates callbacks immediately on logout/account switch,
// before React effects or navigation teardown have run.
export function conversationSessionLease() {
  const owner = accountOwner, epoch = accountEpoch;
  return () => !!owner && owner === accountOwner && epoch === accountEpoch;
}
function file(owner = accountOwner) {
  return new File(Paths.document, owner ? `ozira-account-${owner}.json` : 'ozira-preferences.json');
}
function assertCurrent(store, authenticated = false) {
  if (!store || store.__owner !== accountOwner || store.__epoch !== accountEpoch || (authenticated && !accountOwner)) {
    throw Object.assign(new Error('Account changed. Reopen this conversation.'), { code: 'ACCOUNT_CHANGED' });
  }
}
async function load() {
  if (cache) return cache;
  const owner = accountOwner, epoch = accountEpoch;
  let loaded = null;
  try {
    const f = file(owner);
    if (f.exists) { const t = await f.text(); loaded = t ? JSON.parse(t) : null; }
  } catch (_) {}
  if (owner !== accountOwner || epoch !== accountEpoch) throw Object.assign(new Error('Account changed.'), { code: 'ACCOUNT_CHANGED' });
  if (!loaded || loaded.ownerId !== owner) loaded = {};
  const value = { ...loaded, ownerId: owner, conversations: loaded.conversations || {}, order: loaded.order || [], folders: loaded.folders || [], idMap: loaded.idMap || {} };
  Object.defineProperties(value, { __owner: { value: owner }, __epoch: { value: epoch } });
  cache = value;
  return cache;
}
async function persist(store = cache) {
  assertCurrent(store);
  try {
    const f = file(store.__owner);
    if (!f.exists) { try { f.create(); } catch (_) {} }
    await Promise.resolve(f.write(JSON.stringify(store)));
  } catch (_) {}
  assertCurrent(store);
}
function normalizedConversation(c) {
  return { ...c, projectId: projectReference(c.projectId), messages: (c.messages || []).map(message => conversationMessage(message, config.API_BASE)).filter(Boolean) };
}

export function newId() { return 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1000); }

// A chat gets a local id the moment it is opened, before the server has ever
// seen it. The first save returns the server's id; this map ties the two
// together so screens can keep using the id they already hold.
async function serverId(localId, expected) {
  const s = expected || await load();
  assertCurrent(s, true);
  return s.idMap[localId] || localId;
}
async function linkId(localId, remoteId, expected) {
  if (!localId || !remoteId || localId === remoteId) return;
  const s = expected || await load();
  assertCurrent(s, true);
  s.idMap[localId] = remoteId;
  if (s.conversations[localId]) s.conversations[remoteId] = { ...s.conversations[localId], id: remoteId };
  s.order = s.order.map(id => id === localId ? remoteId : id).filter((id, index, ids) => ids.indexOf(id) === index);
  await persist(s);
}

// Mirror a server conversation into the cache so it survives going offline.
async function cacheConv(c, expected) {
  if (expected) assertCurrent(expected, true);
  if (!c || !c.id) return c;
  const s = expected || await load();
  assertCurrent(s, true);
  s.conversations[c.id] = { ...(s.conversations[c.id] || {}), ...normalizedConversation(c) };
  s.order = [c.id, ...s.order.filter(x => x !== c.id)];
  await persist(s);
  return c;
}

// Retry pending chats only within their verified account cache. Unowned legacy
// device history is never attributed to whoever next signs in.
async function ensureMigrated() {
  const s = await load();
  assertCurrent(s, true);
  if (s.migratedToAccount) return;
  const local = Object.values(s.conversations)
    .filter(c => c && c.id && Array.isArray(c.messages) && c.messages.length && !s.idMap[c.id]);
  for (const c of local) {
    try {
      assertCurrent(s, true);
      const d = await api.saveConversation({ title: c.title, projectId: projectReference(c.projectId), messages: c.messages });
      assertCurrent(s, true);
      if (d && d.id) {
        s.idMap[c.id] = d.id;
        if (c.pinned || c.archived) { try { await api.conversationMeta(d.id, { pinned: !!c.pinned, archived: !!c.archived }); } catch (_) {} }
      }
    } catch (e) { return; }   // network trouble: leave the flag unset and retry later
  }
  s.migratedToAccount = true;
  await persist(s);
}
let migrationInFlight = null;
function migrateInBackground() {
  if (!migrationInFlight) {
    migrationInFlight = ensureMigrated().finally(() => { migrationInFlight = null; });
  }
  return migrationInFlight;
}

export async function listConversations(folderId, opts = {}) {
  const scope = await load();
  assertCurrent(scope, true);
  try {
    // Migration can involve many old local chats and used to block the entire
    // history screen. It is safe to let it finish in the background.
    migrateInBackground().catch(() => {});
    const d = await api.conversations(opts.archived ? '__archived' : folderId);
    assertCurrent(scope, true);
    const list = (d.conversations || []).map(c => ({
      id: c.id, title: c.title, folderId: c.folderId || null, projectId: projectReference(c.projectId),
      pinned: !!c.pinned, archived: !!c.archived, count: c.count,
    }));
    const s = scope;
    list.forEach(c => { s.conversations[c.id] = { ...(s.conversations[c.id] || {}), ...c }; });
    s.order = [...list.map(c => c.id), ...s.order.filter(id => !list.some(c => c.id === id))];
    await persist(s);
    return list;
  } catch (_) {
    // Offline fallback is allowed only for the same authenticated account.
    assertCurrent(scope, true);
    const s = scope;
    let ids = s.order;
    if (folderId) ids = ids.filter(id => s.conversations[id] && s.conversations[id].folderId === folderId);
    let list = ids.map(id => s.conversations[id]).filter(Boolean);
    list = opts.archived ? list.filter(c => c.archived) : list.filter(c => !c.archived);
    return [...list.filter(c => c.pinned), ...list.filter(c => !c.pinned)];
  }
}

// Update flags on a conversation (pinned, archived, ...).
export async function setConversationMeta(id, patch) {
  const s = await load();
  assertCurrent(s, true);
  const rid = await serverId(id, s);
  assertCurrent(s, true);
  if (s.conversations[id]) Object.assign(s.conversations[id], patch);
  if (s.conversations[rid]) Object.assign(s.conversations[rid], patch);
  await persist(s);
  assertCurrent(s, true);
  try { await api.conversationMeta(rid, patch); } catch (_) {}
}

// Read the on-device copy without touching the network. Chat screens use this
// first so a conversation opens immediately, then refresh from the account.
export async function getCachedConversation(id) {
  const scope = await load();
  assertCurrent(scope, true);
  const rid = await serverId(id, scope);
  assertCurrent(scope, true);
  const s = scope;
  return s.conversations[rid] || s.conversations[id] || null;
}

export async function getConversation(id) {
  const scope = await load();
  assertCurrent(scope, true);
  const rid = await serverId(id, scope);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    assertCurrent(scope, true);
    const d = await api.getConversation(rid, undefined, controller.signal);
    assertCurrent(scope, true);
    const c = d.conversation ? normalizedConversation(d.conversation) : null;
    if (c) await cacheConv(c, scope);
    return c;
  } catch (_) {
    assertCurrent(scope, true);
    return getCachedConversation(id);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveConversation(conv) {
  const s = await load();
  assertCurrent(s, true);
  conv = normalizedConversation(conv);
  if (s.settings && s.settings.saveHistory === false) return; // history saving turned off
  const now = Date.now();
  const existing = s.conversations[conv.id];
  s.conversations[conv.id] = {
    folderId: null,
    ...(existing || {}),
    ...conv,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  s.order = [conv.id, ...s.order.filter(x => x !== conv.id)];
  await persist(s);
  try {
    const rid = await serverId(conv.id, s);
    assertCurrent(s, true);
    const d = await api.saveConversation({
      projectId: conv.projectId,
      id: rid === conv.id && !s.idMap[conv.id] ? undefined : rid,
      title: conv.title,
      messages: conv.messages || [],
    });
    assertCurrent(s, true);
    if (d && d.id) await linkId(conv.id, d.id, s);
  } catch (_) { /* stays in the cache; the next save retries */ }
}

export async function deleteConversation(id) {
  const s = await load();
  assertCurrent(s, true);
  const rid = await serverId(id, s);
  assertCurrent(s, true);
  delete s.conversations[id];
  delete s.conversations[rid];
  delete s.idMap[id];
  s.order = s.order.filter(x => x !== id && x !== rid);
  await persist(s);
  assertCurrent(s, true);
  try { await api.deleteConversation(rid); } catch (_) {}
}

export async function listFolders() {
  const scope = await load();
  assertCurrent(scope, true);
  try {
    const d = await api.folders();
    assertCurrent(scope, true);
    const s = scope;
    s.folders = (d.folders || []).map(f => ({ id: f.id, name: f.name }));
    await persist(s);
    return s.folders.slice();
  } catch (_) {
    assertCurrent(scope, true);
    return scope.folders.slice();
  }
}

export async function createFolder(name) {
  const scope = await load();
  assertCurrent(scope, true);
  const d = await api.createFolder(String(name).slice(0, 40));
  assertCurrent(scope, true);
  const f = d.folder;
  const s = scope;
  s.folders.push(f);
  await persist(s);
  return f;
}

export async function deleteFolder(id) {
  const s = await load();
  assertCurrent(s, true);
  s.folders = s.folders.filter(f => f.id !== id);
  Object.values(s.conversations).forEach(c => { if (c.folderId === id) c.folderId = null; });
  await persist(s);
  assertCurrent(s, true);
  try { await api.deleteFolder(id); } catch (_) {}
}

export async function setConversationFolder(id, folderId) {
  return setConversationMeta(id, { folderId: folderId || null });
}

// --- app preferences (device-local on purpose) ---
export async function getTheme() {
  const s = await load();
  return s.theme || 'dark';
}
export async function setTheme(mode) {
  const s = await load();
  s.theme = mode;
  await persist(s);
}

// --- app settings ---
export async function getSettings() {
  const s = await load();
  return s.settings || {};
}
export async function setSettings(patch) {
  const s = await load();
  s.settings = { ...(s.settings || {}), ...patch };
  await persist(s);
  return s.settings;
}
export async function purgeAllHistory() {
  const s = await load();
  assertCurrent(s, true);
  const ids = Object.keys(s.conversations);
  s.conversations = {};
  s.order = [];
  s.idMap = {};
  await persist(s);
  // Clear the account copy too, or they would reappear on the next refresh.
  for (const cid of ids) { assertCurrent(s, true); try { await api.deleteConversation(cid); } catch (_) {} }
}

// --- profile / personalization ---
export async function getProfile() {
  const s = await load();
  return s.profile || {};
}
export async function getProfileOwnerId() {
  const s = await load();
  return s.profileOwnerId || '';
}
export async function replaceProfile(profile, ownerId) {
  const s = await load();
  if (ownerId && ownerId !== s.__owner) throw Object.assign(new Error("Account changed."), { code: "ACCOUNT_CHANGED" });
  s.profile = { ...(profile || {}) };
  s.profileOwnerId = ownerId || '';
  await persist(s);
  return s.profile;
}
export async function setProfile(patch) {
  const s = await load();
  s.profile = { ...(s.profile || {}), ...patch };
  await persist(s);
  return s.profile;
}
