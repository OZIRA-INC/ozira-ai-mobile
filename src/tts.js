// Text-to-speech playback: asks the backend for WAV audio, writes it to a cache
// file, and plays it. One player at a time.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { writeAsStringAsync, cacheDirectory, EncodingType } from 'expo-file-system/legacy';
import { api } from './api';
import { getSettings, conversationSessionLease } from './localStore';

let player = null;
let playbackEpoch = 0;

function stopPlayer() {
  if (player) {
    try { player.pause(); player.remove(); } catch (_) {}
    player = null;
  }
}

export function stopSpeaking() {
  playbackEpoch += 1; // invalidate pending fetch/mode/file callbacks too
  stopPlayer();
}

function audioPayload(audio, response) {
  // The API has used both data URLs and plain base64 over time.  Accept either
  // response, and preserve the format when the server tells us what it is.
  const value = String(audio || '').trim();
  const match = value.match(/^data:([^;,]+)(?:;[^,]*)?,(.*)$/s);
  const mimeType = (match?.[1] || response?.mimeType || response?.contentType || response?.format || 'audio/wav').toLowerCase();
  const base64 = match ? match[2] : value;
  if (!base64) throw new Error('The voice service returned an empty audio payload.');
  const ext = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3'
    : mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('aac') ? 'm4a'
        : 'wav';
  return { base64, ext };
}

export async function speakText(text, token, onEnd) {
  const clean = (text || '').trim();
  if (!clean) return { ok: false, message: 'Nothing to read.' };
  stopSpeaking();
  const epoch = playbackEpoch;
  const ownerCurrent = conversationSessionLease();
  const current = () => epoch === playbackEpoch && ownerCurrent();
  const cancelled = () => ({ ok: false, cancelled: true });
  if (!current()) return cancelled();
  let voice = 'Kore';
  let lang = 'en';
  try {
    const s = await getSettings();
    lang = s.lang || 'en';
    // Kore/Aoede/Charon/Puck are general-provider voices. Do not send one for
    // Amharic or Afaan Oromoo: the backend must choose the native Addis voice
    // from its language-specific catalog instead of falling back to generic TTS.
    voice = (lang === 'am' || lang === 'om') ? undefined : (s.voice || 'Kore');
  } catch (_) {}
  if (!current()) return cancelled();
  let d;
  try { d = await api.aiSpeak(clean.slice(0, 4000), token, voice); }
  catch (e) { return current() ? { ok: false, message: e.message } : cancelled(); }
  if (!current()) return cancelled();
  if (!d || (!d.audio && !d.audioUrl && !d.audio_url)) return { ok: false, message: (d && (d.notice || d.error)) || 'Voice output is not available yet.' };
  try {
    // Recording mode can route output to the earpiece or suppress it on some
    // devices. Return to playback mode before creating the player.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!current()) return cancelled();
    let source = d.audioUrl || d.audio_url;
    if (!source) {
      const { base64, ext } = audioPayload(d.audio, d);
      source = cacheDirectory + 'ozira-tts-' + Date.now() + '.' + ext;
      await writeAsStringAsync(source, base64, { encoding: EncodingType.Base64 });
    }
    if (!current()) return cancelled();
    stopPlayer();
    player = createAudioPlayer(source);
    if (typeof onEnd === 'function') {
      try {
        const sub = player.addListener('playbackStatusUpdate', (st) => {
          if (current() && st && st.didJustFinish) { try { sub.remove(); } catch (_) {} onEnd(); }
        });
      } catch (_) {}
    }
    player.play();
    return { ok: true };
  } catch (e) {
    if (!current()) return cancelled();
    return { ok: false, message: 'Could not play audio: ' + e.message };
  }
}
