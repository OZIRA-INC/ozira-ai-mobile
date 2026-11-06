import { config } from './config';
import { documentArtifact, ownedAssetUrl } from './conversationContract';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

let authToken = null;
export function setToken(t) { authToken = t; }
let deviceId = null;
let deviceInit = null;
async function getDeviceId() {
  if (deviceId) return deviceId;
  if (!deviceInit) deviceInit = (async () => {
    let existing = await AsyncStorage.getItem('ozira_device_id');
    if (!existing) {
      existing = 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 18);
      await AsyncStorage.setItem('ozira_device_id', existing);
    }
    deviceId = existing;
    return existing;
  })().finally(() => { deviceInit = null; });
  return deviceInit;
}
export const prepareDeviceIdentity = () => getDeviceId();
const deviceLabel = () => 'OZIRA Mobile · ' + (Platform.OS === 'ios' ? 'iPhone/iPad' : 'Android');

// The app language, mirrored here so voice calls can carry it without every
// caller threading it through. Amharic/Afaan Oromo route to the native Addis AI
// voice on the backend; the value comes from LanguageContext.
let currentLang = 'en';
export function setApiLang(l) { if (l) currentLang = l; }

async function req(path, { method, body, token, signal } = {}) {
  const requestToken = token || authToken; // capture before an account can switch during device lookup
  const sessionDeviceId = await getDeviceId();
  const res = await fetch(config.API_BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      'x-ozira-device-id': sessionDeviceId,
      'x-ozira-device-label': deviceLabel(),
      ...(requestToken ? { authorization: 'Bearer ' + requestToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('Request failed (' + res.status + ')'));
    err.code = data.code;
    throw err;
  }
  return data;
}

async function realtimeSdp(sdp, lang, token, signal) {
  const requestToken = token || authToken;
  const sessionDeviceId = await getDeviceId();
  const res = await fetch(
    config.API_BASE + '/api/ai/realtime?ground=1&lang=' + encodeURIComponent(lang || currentLang || 'en'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/sdp',
        'x-ozira-device-id': sessionDeviceId,
        'x-ozira-device-label': deviceLabel(),
        ...(requestToken ? { authorization: 'Bearer ' + requestToken } : {}),
      },
      body: sdp,
      signal,
    },
  );
  const raw = await res.text();
  if (!res.ok) {
    let message = raw;
    try { message = JSON.parse(raw).error || message; } catch (_) {}
    throw new Error(message || ('Realtime connection failed (' + res.status + ')'));
  }
  if (!/^v=0/m.test(raw)) throw new Error('Realtime service returned an invalid connection answer.');
  return raw;
}

export function absUrl(u) {
  if (!u) return u;
  return /^https?:/.test(u) ? u : config.API_BASE + u;
}

export const api = {
  login: (email, password) => req('/api/login', { body: { email, password } }),
  register: (name, email, password) => req('/api/register', { body: { name, email, password } }),
  me: (token) => req('/api/me', { token }),
  telegramLinkCode: (token) => req('/api/telegram/link-code', { body: {}, token }),
  plans: () => req('/api/plans'),
  chat: (payload, token, signal) => req('/api/chat', { body: payload, token, signal }),
  image: (payload, token, signal) => req('/api/image', { body: payload, token, signal }),
  imageEdit: (payload, token, signal) => req('/api/image/edit', { body: payload, token, signal }),
  conversations: (folderId, token) => req('/api/conversations' + (folderId ? '?folder=' + encodeURIComponent(folderId) : ''), { token }),
  getConversation: (id, token, signal) => req('/api/conversations/get', { body: { id }, token, signal }),
  saveConversation: (conv, token) => req('/api/conversations/save', { body: conv, token }),
  deleteConversation: (id, token) => req('/api/conversations/delete', { body: { id }, token }),
  conversationMeta: (id, patch, token) => req('/api/conversations/meta', { body: { id, ...patch }, token }),
  folders: (token) => req('/api/folders', { token }),
  createFolder: (name, token) => req('/api/folders/create', { body: { name }, token }),
  deleteFolder: (id, token) => req('/api/folders/delete', { body: { id }, token }),
  images: (token) => req('/api/images', { token }),
  deleteImage: (payload, token) => req('/api/images/delete', { body: payload, token }),
  feedback: (value, model, text, token) => req('/api/feedback', { body: { value, model, text }, token }),
  subscribe: (planId, provider, token) => req('/api/subscribe', { body: { planId, provider }, token }),
  travelListings: (params, token) => {
    const qs = new URLSearchParams(params || {}).toString();
    return req('/api/travel/listings' + (qs ? '?' + qs : ''), { token });
  },
  travelLead: (listingId, message, token) => req('/api/travel/lead', { body: { listingId, message }, token }),
  travelCompare: (question, listingIds, token) => req('/api/travel/compare', { body: { question, listingIds }, token }),
  devKeys: (token) => req('/api/dev/keys', { token }),
  devKeyCreate: (name, token) => req('/api/dev/keys', { body: { name }, token }),
  devKeyRevoke: (id, token) => req('/api/dev/keys/revoke', { body: { id }, token }),
  // --- new AI endpoints (need the backend patch deployed) ---
  aiCapabilities: (token) => req('/api/ai/capabilities', { token }),
  aiChat: (payload, token, signal) => req('/api/ai/chat', { body: payload, token, signal }),
  aiVision: (payload, token, signal) => req('/api/ai/vision', { body: payload, token, signal }),
  aiResearch: (query, token, signal) => req('/api/ai/research', { body: { query }, token, signal }),
  aiTranscribe: (audio, mimeType, token) => req('/api/ai/transcribe', { body: { audio, mimeType, lang: currentLang }, token }),
  aiSpeak: (text, token, voice) => req('/api/ai/speak', { body: { text, voice, lang: currentLang }, token }),
  aiRealtime: (sdp, lang, token, signal) => realtimeSdp(sdp, lang, token, signal),
  // --- teams ---
  team: (token) => req('/api/team', { token }),
  teamCreate: (name, token) => req('/api/team/create', { body: { name }, token }),
  teamJoin: (code, token) => req('/api/team/join', { body: { code }, token }),
  teamLeave: (token) => req('/api/team/leave', { body: {}, token }),
  teamRemove: (email, token) => req('/api/team/remove', { body: { email }, token }),
  // --- scheduled tasks ---
  schedules: (token) => req('/api/schedules', { token }),
  scheduleCreate: (payload, token) => req('/api/schedules', { body: payload, token }),
  scheduleDelete: (id, token) => req('/api/schedules/delete', { body: { id }, token }),
  // --- import / migrate ---
  importData: (source, data, token) => req('/api/import', { body: { source, data }, token }),
  // --- email verification ---
  verifyEmail: (code, token) => req('/api/verify-email', { body: { code }, token }),
  resendVerification: (token) => req('/api/resend-verification', { body: {}, token }),
  deleteAccount: (email, token) => req('/api/me/delete', { body: { confirm: email }, token }),
  usage: (token) => req('/api/usage', { token }),
  storage: (token) => req('/api/storage', { token }),
  sessions: (token) => req('/api/sessions', { token }),
  revokeSession: (id, token) => req('/api/sessions/revoke', { body: { id }, token }),
  profile: (token) => req('/api/profile', { token }),
  saveProfile: (profile, token) => req('/api/profile', { body: { profile }, token }),
  // --- language ---
  settingsLang: (lang, token) => req('/api/settings/lang', { body: { lang }, token }),
  settings: (token) => req('/api/settings', { token }),
  saveSettings: (settings, token) => req('/api/settings', { body: { settings }, token }),
  // --- unified memory (backend store.memories via /v1/memories) ---
  // The server recalls these memories and injects them into every chat prompt;
  // the client never sends them itself.
  memories: (token) => req('/v1/memories', { token }),
  memoryCreate: (input, token) => req('/v1/memories', { body: { ...input, evidence: memoryEvidence() }, token }),
  memoryCorrect: (id, content, reason, token) => req('/v1/memories/' + encodeURIComponent(id) + '/correct', { body: { content, reason, evidence: memoryEvidence(), requestId: requestId() }, token }),
  memoryApprove: (id, token) => req('/v1/memories/' + encodeURIComponent(id), { method: 'PATCH', body: { status: 'active', requestId: requestId() }, token }),
  memoryDelete: (id, token) => req('/v1/memories/' + encodeURIComponent(id), { method: 'DELETE', body: { requestId: requestId() }, token }),
  memoryDeleteAll: (token) => req('/v1/memories', { method: 'DELETE', body: { requestId: requestId() }, token }),
  // Canonical settings registry. Memory recall/capture require BOTH consent
  // keys persisted as user-scope true, so the toggle always writes both.
  memorySettings: (token) => req('/v1/settings', { token }),
  saveMemorySettings: (settings, token) => req('/v1/settings', { method: 'PATCH', body: { settings }, token }),
};

function requestId() { return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
// Manual memories are user statements made in the Memory screen; the backend
// requires a non-empty source conversation/message pair for every write.
function memoryEvidence() { return { sourceConversationId: 'mobile-memory-screen', sourceMessageId: requestId() }; }

// Authenticated binary download, never place bearer tokens in browser URLs.
export async function downloadDocument(value, token, signal) {
  const artifact = documentArtifact(value);
  const requestToken = token || authToken;
  if (!artifact || !requestToken) throw new Error('Sign in to download this document.');
  const sessionDeviceId = await getDeviceId();
  const response = await fetch(config.API_BASE + artifact.downloadUrl, { headers: { authorization: 'Bearer ' + requestToken, 'x-ozira-device-id': sessionDeviceId, 'x-ozira-device-label': deviceLabel() }, signal, redirect: 'error' });
  if (!response.ok) throw new Error('Document download failed (' + response.status + ').');
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  if (mime !== artifact.mimeType) throw new Error('Unexpected document type.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== artifact.byteLength || bytes.length > 1048576) throw new Error('Unexpected document size.');
  return { artifact, bytes };
}

// Native image loading and explicit exports share one credential boundary.
// Approved environment aliases are canonicalized to the configured gateway;
// the bearer header is never attached to a foreign origin or non-image path.
export function generatedImageSource(value, token) {
  const owned = ownedAssetUrl(value, config.API_BASE);
  if (!owned) return { uri: value };
  const uri = new URL(new URL(owned).pathname, config.API_BASE).href;
  const requestToken = token === undefined ? authToken : token;
  // Synchronous Image sources cannot await storage: remain closed until the
  // navigator's approved initialization completes. Never mint another ID.
  if (!deviceId) return { uri: undefined };
  return { uri, cache: 'reload', headers: { 'x-ozira-device-id': deviceId, 'x-ozira-device-label': deviceLabel(), ...(requestToken ? { authorization: 'Bearer ' + requestToken } : {}) } };
}
export async function downloadGeneratedImage(value, token, signal) {
  if (!ownedAssetUrl(value, config.API_BASE)) throw new Error('Image is outside the configured environment.');
  const requestToken = token || authToken;
  await getDeviceId();
  const source = generatedImageSource(value, requestToken);
  const response = await fetch(source.uri, { headers: source.headers || {}, signal, redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error('Image download failed (' + response.status + ').');
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
  if (!extension) throw new Error('Unexpected image type.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Unexpected image size.');
  return { bytes, mimeType: mime, fileName: 'ozira-image.' + extension };
}
