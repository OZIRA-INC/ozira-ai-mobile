import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, ImageBackground, Keyboard, Platform, ActivityIndicator, Modal, Alert, Share, Animated, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius } from '../theme';
import { useColors } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useLang } from '../context/LanguageContext';
import { rtlText, rtlRow, rtlIcon } from '../i18n';
import { useNotify } from '../context/NotifyContext';
import { api, absUrl, generatedImageSource, downloadGeneratedImage } from '../api';
import Markdown from '../components/Markdown';
import WebsiteArtifact from '../components/WebsiteArtifact';
import DocumentArtifact from '../components/DocumentArtifact';
import { shareArtifactFile } from '../artifactFiles';
import { config } from '../config';
import { conversationMessage, assistantMessage, requestMessages, projectReference } from '../conversationContract';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { ensurePrepared, finalizeRecording } from '../audioSession';
import { getCachedConversation, getConversation, saveConversation, deleteConversation, setConversationMeta, setConversationFolder, listFolders, newId, conversationSessionLease } from '../localStore';
import Logo from '../components/Logo';
import FlagMenu from '../components/FlagMenu';
import VoiceOverlay from '../components/VoiceOverlay';
import AssistantActionIcon from '../components/AssistantActionIcon';
import { speakText, stopSpeaking } from '../tts';

const FLAG = { green: '#078930', yellow: '#FCDD09', red: '#DA121A' };
const PRIMARY_RED = '#B3121B';
const RESPONSE_LEVEL_IDS = [
  { id: 'quick', icon: 'flash' },
  { id: 'balanced', icon: 'remove' },
  { id: 'deep', icon: 'sparkles' },
];

function ThinkingDots() {
  const values = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const animations = values.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 150),
      Animated.timing(value, { toValue: 1, duration: 210, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 210, useNativeDriver: true }),
      Animated.delay(260),
    ])));
    animations.forEach(animation => animation.start());
    return () => animations.forEach(animation => animation.stop());
  }, [values]);
  return <View style={stylesForThinking.dots}>{[FLAG.green, FLAG.yellow, FLAG.red].map((color, index) => (
    <Animated.View key={color} style={[stylesForThinking.dot, { backgroundColor: color, transform: [{ translateY: values[index].interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }, { scale: values[index].interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }] }]} />
  ))}</View>;
}
const stylesForThinking = StyleSheet.create({ dots: { flexDirection: 'row', alignItems: 'center', gap: 5 }, dot: { width: 7, height: 7, borderRadius: 4 } });

// Starter prompts shown on the empty chat screen (translated via i18n keys).
const SUGGESTIONS = [
  { key: 'sug1', icon: 'create-outline' },
  { key: 'sug2', icon: 'bulb-outline' },
  { key: 'sug3', icon: 'airplane-outline' },
  { key: 'sug4', icon: 'school-outline' },
];

const MENU = [
  { key: 'photo', label: 'Photo', sub: 'Send a picture to the AI', icon: 'image' },
  { key: 'camera', label: 'Camera', sub: 'Take a photo now', icon: 'camera' },
  { key: 'file', label: 'File', sub: 'PDF, text or document', icon: 'document-text' },
  { key: 'image', label: 'Create image', sub: 'Generate a picture with AI', icon: 'color-palette' },
  { key: 'research', label: 'Research', sub: 'Search the web to answer', icon: 'globe' },
  { key: 'connector', label: 'Connectors', sub: 'Link Telegram, Drive, Gmail…', icon: 'git-network' },
];

// Users should not have to know they must first enable image mode. Recognize a
// natural image request, then keep that thread in image mode for follow-ups.
function isImageRequest(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const visual = /\b(image|picture|photo|photograph|logo|drawing|artwork|illustration|poster|wallpaper|portrait|icon|banner|flag|sticker|meme)\b|(?:ምስል|ስዕል|ፎቶ|ሥዕል)/i;
  const intent = /\b(generate|create|make|design|produce|draw|paint|sketch|illustrate|render|show|give|want|need)\b|(?:ፍጠር|ስራ|አውጣ|ሳል|ንደፍ)/i;
  return visual.test(text) && intent.test(text);
}

function imageFromDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
    base64: match[2],
  };
}

export default function ChatConversationScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { token, user } = useAuth();
  const { openSidebar } = useUI();
  const { lang, t, rtl } = useLang();
  const { notify } = useNotify();
  const responseLevels = useMemo(() => RESPONSE_LEVEL_IDS.map(level => ({
    ...level, label: t(level.id === 'quick' ? 'instant' : level.id === 'balanced' ? 'medium' : 'high'),
    sub: t(level.id === 'quick' ? 'instantSub' : level.id === 'balanced' ? 'mediumSub' : 'highSub'),
  })), [t]);
  const firstName = ((user?.name || '').trim().split(' ')[0]) || 'there';
  const greetWord = (() => { const h = new Date().getHours(); return h < 12 ? t('morning') : h < 18 ? t('afternoon') : t('evening'); })();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const [messages, updateMessages] = useState([]);
  const sessionLease = useRef(null);
  if (!sessionLease.current) sessionLease.current = conversationSessionLease();
  const mounted = useRef(true);
  const currentSession = () => mounted.current && sessionLease.current();
  // Guard every message update, including voice/restore/error callbacks.
  const setMessages = value => { if (currentSession()) updateMessages(value); };
  const [projectId, setProjectId] = useState(projectReference(route.params?.projectId));
  const [input, setInput] = useState('');
  const [imageMode, setImageMode] = useState(!!route.params?.imageMode);
  const [mode, setMode] = useState('fast'); // 'fast' | 'smart'
  const [effort, setEffort] = useState('quick'); // Instant | Medium | High
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachment, setAttachment] = useState(null); // { kind:'photo'|'file', name, base64, mimeType, text }
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const abortRef = useRef(null);
  const [convId, setConvId] = useState(route.params?.conversationId || newId());
  const dirtyRef = useRef(false);
  const [kb, setKb] = useState(0);
  const [modeOpen, setModeOpen] = useState(false);     // Model + reply-depth picker
  const [convMenu, setConvMenu] = useState(false);     // top-right ⋯ menu
  const [pinned, setPinned] = useState(false);
  const [folderPick, setFolderPick] = useState(null);  // list of folders when picking
  const [reactions, setReactions] = useState({});      // index -> 1 | -1
  const [speakBusy, setSpeakBusy] = useState(null);    // index currently loading audio
  const [speakingIdx, setSpeakingIdx] = useState(null);// index currently playing
  const [copiedIdx, setCopiedIdx] = useState(null);    // temporary copy checkmark
  const copiedTimerRef = useRef(null);
  const [assistantMenu, setAssistantMenu] = useState(null); // { index, message }
  const [voiceOpen, setVoiceOpen] = useState(false);   // live voice overlay
  const [editIdx, setEditIdx] = useState(null);         // index of message being edited
  const [viewerImage, setViewerImage] = useState(null); // { url, id, prompt, index }
  const [editSource, setEditSource] = useState(null);   // image selected for the next AI edit
  const [resizeImage, setResizeImage] = useState(null);
  const [savingImage, setSavingImage] = useState(false);
  const [imageSaved, setImageSaved] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dirtyRef.current = false;
      abortRef.current?.abort();
      stopSpeaking();
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);
  useEffect(() => { setImageSaved(false); }, [viewerImage]);
  useEffect(() => {
    const sourceImage = route.params?.sourceImage;
    if (!sourceImage) return;
    setEditSource({
      url: absUrl(sourceImage),
      id: route.params?.sourceImageId || null,
      operation: route.params?.imageOperation || '',
      size: route.params?.imageSize || '',
    });
    setImageMode(true);
    setInput(route.params?.editPrompt || '');
    setTimeout(() => inputRef.current?.focus(), 120);
    navigation.setParams({
      sourceImage: undefined, sourceImageId: undefined,
      imageOperation: undefined, imageSize: undefined, editPrompt: undefined,
    });
  }, [route.params?.sourceImage]);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, e => { setKb(e.endCoordinates.height); scrollDown(); });
    const h = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  async function startRec() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow microphone access to record a voice message.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await ensurePrepared(recorder);
      recorder.record();
      setRecording(true);
    } catch (e) { Alert.alert('Error', e.message); }
  }

  async function stopRec() {
    setRecording(false);
    setTranscribing(true);
    try {
      const { uri } = await finalizeRecording(recorder);
      if (!uri) throw new Error('No recording captured.');
      const b64 = await new File(uri).base64();
      const d = await api.aiTranscribe(b64, Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4', token);
      if (!currentSession()) return;
      if (d.configured === false) Alert.alert('Voice not set up yet', d.notice || 'Add the Gemini key in Railway to enable voice-to-text.');
      else if (d.error) Alert.alert('Could not transcribe', d.error);
      else if (d.text) { setTranscribing(false); send(d.text, true); return; }
      else Alert.alert('Nothing heard', 'Try recording again, a bit louder.');
    } catch (e) { Alert.alert('Error', e.message); }
    setTranscribing(false);
  }

  function stopGen() {
    try { if (abortRef.current) abortRef.current.abort(); } catch (_) {}
  }

  function onMenu(key) {
    setMenuOpen(false);
    // Mode toggles are pure state — safe to run immediately.
    if (key === 'image') { setImageMode(true); setResearch(false); return; }
    if (key === 'research') { setResearch(r => !r); setImageMode(false); return; }
    // Let the sheet unmount first, then open the native picker/screen.
    setTimeout(() => {
      if (key === 'photo') pickPhoto();
      else if (key === 'camera') takePhoto();
      else if (key === 'file') pickFile();
      else if (key === 'connector') navigation.navigate('Connectors');
    }, 80);
  }

  async function pickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow photo access to attach a picture.');
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.9,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (r.canceled || !r.assets || !r.assets.length) return;
      const a = r.assets[0];
      if (!a.base64) throw new Error('The selected image could not be read.');
      setImageMode(false); setResearch(false);
      // Expo documents the picker Base64 field as JPEG data. Label the bytes
      // correctly even when the source asset was PNG, HEIC, AVIF, WebP, or GIF.
      setAttachment({ kind: 'photo', name: 'photo.jpg', base64: a.base64, mimeType: 'image/jpeg' });
    } catch (e) { Alert.alert('Photo', e.message || 'Could not open the photo library.'); }
  }

  async function takePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.9,
      });
      if (r.canceled || !r.assets || !r.assets.length) return;
      const a = r.assets[0];
      if (!a.base64) throw new Error('The captured image could not be read.');
      setImageMode(false); setResearch(false);
      setAttachment({ kind: 'photo', name: 'photo.jpg', base64: a.base64, mimeType: 'image/jpeg' });
    } catch (e) { Alert.alert('Camera', e.message || 'Could not open the camera.'); }
  }

  async function pickFile() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets || !r.assets.length) return;
      const a = r.assets[0];
      let textContent = '';
      try { textContent = await new File(a.uri).text(); } catch (_) {}
      setImageMode(false); setResearch(false);
      setAttachment({ kind: 'file', name: a.name || 'file', text: textContent, mimeType: a.mimeType || 'text/plain' });
      if (!textContent) Alert.alert('Heads up', 'Text files work now. PDFs need the server reader (coming soon), so this one may not be understood yet.');
    } catch (e) { Alert.alert('Error', e.message); }
  }

  useEffect(() => {
    const id = route.params?.conversationId;
    if (!id) return;
    let active = true;
    setConvId(id);
    setProjectId(projectReference(route.params?.projectId));
    const showConversation = c => {
      if (!active || !c || !currentSession()) return;
      const restored = (c.messages || []).map(message => conversationMessage(message, config.API_BASE)).filter(Boolean);
      setProjectId(projectReference(c.projectId));
      setMessages(restored);
      setImageMode(!!route.params?.imageMode);
      setPinned(!!c.pinned);
      setReactions({});
    };
    (async () => {
      // Paint the cached thread first; on a normal reopen this takes only a
      // local file read instead of a full network round trip.
      showConversation(await getCachedConversation(id));
      // Refresh silently so changes made on web or another phone still arrive.
      showConversation(await getConversation(id));
    })().catch(() => {});
    return () => { active = false; };
  }, [route.params?.conversationId]);

  // ---- conversation actions (top-right ⋯ menu) ----
  function resetChat() {
    const id = newId();
    setConvId(id); setMessages([]); setProjectId(null); setPinned(false); setReactions({});
    navigation.setParams({ conversationId: id, title: 'New Chat', projectId: null });
  }
  function transcript() {
    return messages.map(m => (m.role === 'user' ? 'You: ' : 'OZIRA: ') + (typeof m.content === 'string' ? m.content : '[image]')).join('\n\n');
  }
  async function shareConversation() {
    setConvMenu(false);
    if (!messages.length) return Alert.alert('Nothing to share', 'Start a conversation first.');
    try { await Share.share({ message: 'OZIRA AI chat\n\n' + transcript() }); } catch (_) {}
  }
  async function togglePin() {
    setConvMenu(false);
    const next = !pinned;
    setPinned(next);
    await setConversationMeta(convId, { pinned: next });
  }
  async function addToProject() {
    setConvMenu(false);
    const fs = await listFolders();
    if (!fs.length) return Alert.alert('No projects yet', 'Create a folder first from the sidebar (Folders › +).');
    setFolderPick(fs);
  }
  async function pickFolder(fid) {
    setFolderPick(null);
    await setConversationFolder(convId, fid);
    Alert.alert('Done', fid ? 'Chat added to the project.' : 'Chat removed from projects.');
  }
  function archiveConversation() {
    setConvMenu(false);
    Alert.alert('Archive chat', 'Move this chat to Archived? You can find it in the sidebar.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', onPress: async () => { await setConversationMeta(convId, { archived: true }); resetChat(); } },
    ]);
  }
  function deleteThis() {
    setConvMenu(false);
    Alert.alert('Delete chat', 'Permanently delete this chat? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteConversation(convId); resetChat(); } },
    ]);
  }

  // ---- per-message actions ----
  async function copyMsg(m, index) {
    try { await Clipboard.setStringAsync(typeof m.content === 'string' ? m.content : ''); } catch (_) {}
    if (index != null) {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopiedIdx(index);
      copiedTimerRef.current = setTimeout(() => setCopiedIdx(null), 1800);
    }
  }
  async function shareMsg(m) {
    if (m.image) return shareGeneratedImage(m.image);
    try { await Share.share({ message: typeof m.content === 'string' ? m.content : '' }); } catch (_) {}
  }
  async function shareGeneratedImage(uri) {
    if (!uri) return;
    const current = conversationSessionLease();
    try { const image = await downloadGeneratedImage(uri, token); if (current()) await shareArtifactFile(image.fileName, image.bytes, image.mimeType, current); }
    catch (error) { if (current()) Alert.alert('Image export', error.message); }
  }
  function beginImageEdit(image, prompt = '', options = {}) {
    if (!image?.url) return;
    setViewerImage(null);
    setResizeImage(null);
    setEditSource({ url: image.url, id: image.id || null, ...options });
    setImageMode(true);
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 120);
  }
  function removeGeneratedImage(image, index) {
    if (!image?.url) return;
    Alert.alert(t('removeImage'), t('removeImageConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'), style: 'destructive', onPress: async () => {
          try {
            await api.deleteImage({ id: image.id || undefined, url: image.url }, token);
            setViewerImage(null);
            dirtyRef.current = true;
            if (index != null) setMessages(prev => prev.filter((_, i) => i !== index));
            notify(t('imageRemoved'), '', 'success');
          } catch (e) {
            Alert.alert(t('removeImage'), e.message || t('notifFailed'));
          }
        },
      },
    ]);
  }
  async function saveGeneratedImage(uri) {
    if (!uri || savingImage) return;
    setSavingImage(true);
    setImageSaved(false);
    try {
      const current = conversationSessionLease();
      const image = await downloadGeneratedImage(uri, token);
      if (!current()) return;
      const destination = new File(Paths.cache, `${Date.now()}-${image.fileName}`);
      destination.create(); destination.write(image.bytes);
      try { await MediaLibrary.saveToLibraryAsync(destination.uri); }
      finally { try { destination.delete(); } catch (_) {} }
      if (!current()) return;
      setImageSaved(true);
      notify(t('notifSaved'), '', 'success');
    } catch (e) {
      Alert.alert('Could not save image', e.message || 'Please try again.');
    } finally {
      setSavingImage(false);
    }
  }
  // Like / dislike. A rating that vanishes is worthless, so we do three things:
  // store it on the message (survives reload), report it to the backend, and —
  // for a dislike — offer to actually fix the answer instead of just logging it.
  async function react(i, m, value) {
    const next = (m.reaction === value) ? 0 : value;
    dirtyRef.current = true;
    setMessages(prev => prev.map((x, idx) => (idx === i ? { ...x, reaction: next } : x)));
    if (next !== 0) {
      try { await api.feedback(next, m.model || 'auto', (typeof m.content === 'string' ? m.content : '').slice(0, 500), token); } catch (_) {}
      if (next === 1) notify(t('thanksFeedback'), '', 'success');
      else {
        Alert.alert(t('thanksFeedback'), t('dislikeAsk'), [
          { text: t('no'), style: 'cancel' },
          { text: t('regenerate'), onPress: () => regenerate(i) },
        ]);
      }
    }
  }

  // Re-ask the question that produced message i, replacing the old answer.
  function regenerate(i) {
    for (let k = i - 1; k >= 0; k--) {
      if (messages[k].role === 'user') {
        const q = typeof messages[k].content === 'string' ? messages[k].content : '';
        if (q) send(q, false, { replaceFrom: k });
        return;
      }
    }
  }

  // Edit a message you already sent: load it back into the composer, then the
  // next send replaces it AND everything after, so the answer is regenerated.
  function startEdit(i, m) {
    setInput(typeof m.content === 'string' ? m.content : '');
    setEditIdx(i);
    scrollDown();
  }
  function cancelEdit() { setEditIdx(null); setInput(''); }
  function webSearch(m) {
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text) return;
    send(text, false, { forceResearch: true });
  }
  function openAssistantActions(i, m, event) {
    const { pageX, pageY } = event?.nativeEvent || {};
    setAssistantMenu({ index: i, message: m, pageX, pageY });
  }
  async function onSpeak(i, m) {
    // Tapping the speaker of the message that's playing/loading stops it.
    if (speakingIdx === i || speakBusy === i) { stopSpeaking(); setSpeakingIdx(null); setSpeakBusy(null); return; }
    stopSpeaking(); setSpeakingIdx(null);
    setSpeakBusy(i);
    const res = await speakText(typeof m.content === 'string' ? m.content : '', token, () => setSpeakingIdx(null));
    setSpeakBusy(null);
    if (res && res.ok) setSpeakingIdx(i);
    else Alert.alert('Voice', (res && res.message) || 'Could not play audio.');
  }
  // Live-voice overlay writes each spoken turn into the chat as text.
  function appendVoiceExchange(userText, aiText) {
    if (!currentSession()) return;
    dirtyRef.current = true;
    setMessages(prev => [...prev, { role: 'user', content: userText }, { role: 'assistant', content: aiText, model: 'Voice' }]);
    scrollDown();
  }
  function voiceHistory() {
    return messages.filter(m => !m.pending && typeof m.content === 'string' && m.content).map(m => ({ role: m.role, content: m.content }));
  }

  // Persist the conversation on-device after each settled exchange.
  useEffect(() => {
    if (!currentSession() || !dirtyRef.current) return;
    if (messages.some(m => m.pending)) return;
    dirtyRef.current = false;
    const firstUser = messages.find(m => m.role === 'user');
    const title = ((firstUser && typeof firstUser.content === 'string' ? firstUser.content : '') || 'New chat').slice(0, 40);
    saveConversation({
      id: convId,
      title, projectId,
      messages: messages.map(message => conversationMessage(message, config.API_BASE)).filter(Boolean),
    }).catch(() => {});
  }, [messages]);

  function scrollDown() { requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }

  async function send(overrideText, fromVoice, opts = {}) {
    if (!currentSession()) return;
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();
    const att = attachment;
    const useResearch = research || !!opts.forceResearch;
    if ((!text && !att) || busy) return;
    setInput('');
    setAttachment(null);
    dirtyRef.current = true;
    const shown = text || (att ? (att.kind === 'photo' ? 'Photo' : att.name) : '');
    const thumb = att && att.kind === 'photo' ? ('data:' + att.mimeType + ';base64,' + att.base64) : null;
    // Editing an earlier message (or regenerating) rewinds history to that point,
    // so the stale answer and everything after it are dropped.
    const cut = opts.replaceFrom != null ? opts.replaceFrom : editIdx;
    const base = cut != null ? messages.slice(0, cut) : messages;
    if (editIdx != null) setEditIdx(null);
    const next = [...base, { role: 'user', content: shown, thumb }];
    setMessages([...next, { role: 'assistant', content: '...', pending: true }]);
    scrollDown();
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    const skill = route.params?.skill || 'general';
    try {
      // A generated-image thread remains in this flow after reopening it on a
      // different device. This prevents a follow-up prompt from being sent to
      // the text model as ordinary chat.
      const wantImage = (imageMode || isImageRequest(text)) && !useResearch;
      // Keep the most recently uploaded image available for follow-up questions,
      // including after this conversation is reopened on another device.
      const visionImage = att && att.kind === 'photo'
        ? { base64: att.base64, mimeType: att.mimeType }
        : imageFromDataUrl([...next].reverse().find(m => m.role === 'user' && m.thumb)?.thumb);
      if (wantImage) {
        if (!imageMode) setImageMode(true);
        const previous = [...next].reverse().find(m => m.role === 'assistant' && m.image);
        const source = editSource || (previous ? { url: previous.image, id: previous.imageId } : null);
        const d = source
          ? await api.imageEdit({
              prompt: text,
              sourceUrl: source.url,
              operation: source.operation || undefined,
              size: source.size || undefined,
            }, token, signal)
          : await api.image({ prompt: text }, token, signal);
        if (!currentSession()) return;
        const img = d.images && d.images[0];
        setEditSource(null);
        setMessages([...next, img ? { role: 'assistant', image: absUrl(img.url), imageId: img.id || null } : { role: 'assistant', content: d.notice || 'No image returned.' }]);
        // Image generation is slow — tell the user it landed.
        if (img) notify(t('notifImageReady'), t('notifImageReadySub'), 'success');
        else notify(t('notifFailed'), d.notice || '', 'warn');
      } else if (useResearch) {
        const d = await api.aiResearch(text, token, signal);
        if (!currentSession()) return;
        const body = d.configured ? (d.text || d.error || 'No result.') : (d.notice || 'Research is not set up yet.');
        const src = (d.sources && d.sources.length) ? '\n\nSources:\n' + d.sources.slice(0, 5).join('\n') : '';
        setMessages([...next, { role: 'assistant', content: body + src, model: 'Research' }]);
        // Read only the answer aloud. Source URLs are useful on screen but should
        // never be sent to TTS, especially for voice-originated requests.
        if (fromVoice && body) {
          const spoken = await speakText(body, token);
          if (!spoken?.ok) notify(t('notifFailed'), spoken?.error || 'Voice playback could not start.', 'warn');
        }
      } else if (visionImage) {
        const history = next.map((m, i) => ({ role: m.role, content: i === next.length - 1 ? (text || 'What is in this image?') : (typeof m.content === 'string' ? m.content : '') }));
        const d = await api.aiVision({ tier: mode, effort, skill, messages: history, images: [visionImage], lang }, token, signal);
        if (!currentSession()) return;
        setMessages([...next, { role: 'assistant', content: d.reply || d.error || 'No reply.', model: d.modelLabel || 'Vision' }]);
      } else {
        let lastContent = text;
        if (att && att.kind === 'file' && att.text) {
          lastContent = 'Here is a file named "' + att.name + '":\n\n' + att.text.slice(0, 12000) + '\n\n' + (text || 'Please read this and help me.');
        }
        const msgs = requestMessages(next.map((m, i) => i === next.length - 1 ? { ...m, content: lastContent } : m), config.API_BASE);
        // Response style (profile.customInstructions) and unified memories are
        // injected server-side from the account, so no client system message.
        const payload = { model: 'auto', tier: mode, effort, skill, messages: msgs, lang, projectId, conversationId: convId };
        const d = await api.chat(payload, token, signal);
        if (!currentSession()) return;
        setMessages([...next, assistantMessage(d, config.API_BASE)]);
        if (fromVoice && d.reply) {
          const spoken = await speakText(d.reply, token);
          if (!spoken?.ok) notify(t('notifFailed'), spoken?.message || 'Could not play the spoken reply.', 'error');
        }
      }
    } catch (e) {
      if (!currentSession()) return;
      if (e.name === 'AbortError') setMessages(next);
      else { setMessages([...next, { role: 'assistant', content: 'Error: ' + e.message }]); notify(t('notifFailed'), e.message, 'error'); }
    }
    if (!currentSession()) return;
    abortRef.current = null;
    setBusy(false);
    scrollDown();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kb }}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <FlagMenu onPress={openSidebar} size={22} />
        <Pressable onPress={() => setModeOpen(o => !o)} style={styles.modeSel}>
          <Ionicons name={mode === 'smart' ? 'sparkles' : 'flash'} size={13} color={colors.primary} />
          <Text style={styles.modeSelTxt}>{mode === 'smart' ? t('smart') : t('fast')} · {responseLevels.find(x => x.id === effort)?.label || t('instant')}</Text>
          <Ionicons name={modeOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.muted} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{route.params?.title || (imageMode ? 'Image Generator' : '')}</Text>
        <Pressable onPress={() => setConvMenu(true)} hitSlop={8} style={styles.moreBtn} accessibilityRole="button" accessibilityLabel="Conversation options">
          <Ionicons name="ellipsis-vertical" size={19} color={colors.primary} />
        </Pressable>
      </View>

      {modeOpen && <Pressable style={styles.modeDismiss} onPress={() => setModeOpen(false)} />}
      {modeOpen && (
        <View style={styles.modeDrop}>
          <Text style={styles.dropLabel}>{t('chooseModel')}</Text>
          <Pressable onPress={() => setMode('fast')} style={[styles.modeDropRow, mode === 'fast' && styles.modeDropOn]}>
            <Ionicons name="flash" size={15} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeDropTitle}>{t('fast')}</Text>
              <Text style={styles.modeDropSub}>{t('fastSub')}</Text>
            </View>
            {mode === 'fast' && <Ionicons name="checkmark" size={16} color={colors.primary} />}
          </Pressable>
          <Pressable onPress={() => setMode('smart')} style={[styles.modeDropRow, mode === 'smart' && styles.modeDropOn]}>
            <Ionicons name="sparkles" size={15} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeDropTitle}>{t('smart')}</Text>
              <Text style={styles.modeDropSub}>{t('smartSub')}</Text>
            </View>
            {mode === 'smart' && <Ionicons name="checkmark" size={16} color={colors.primary} />}
          </Pressable>
          <View style={styles.dropDivider} />
          <Text style={styles.dropLabel}>{t('replyDepth')}</Text>
          {responseLevels.map(level => (
            <Pressable key={level.id} onPress={() => setEffort(level.id)} style={[styles.modeDropRow, effort === level.id && styles.modeDropOn]}>
              <Ionicons name={level.icon} size={15} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeDropTitle}>{level.label}</Text>
                <Text style={styles.modeDropSub}>{level.sub}</Text>
              </View>
              {effort === level.id && <Ionicons name="checkmark" size={16} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 16 }} onContentSizeChange={scrollDown}>
        {messages.length === 0 && (
          <View style={styles.empty}>
            {/* The same artwork as the sidebar gives the empty-chat home a connected look. */}
            <ImageBackground source={require('../../assets/sidebar-artistic-gradient.png')} style={styles.hero} imageStyle={styles.heroArt}>
              <View style={styles.heroInner}>
              <View style={styles.heroLogo}>
                {imageMode ? <Ionicons name="image" size={34} color={PRIMARY_RED} /> : <Logo size={44} />}
              </View>
              <View style={styles.triDots}>
                <View style={[styles.dot, { backgroundColor: FLAG.green }]} />
                <View style={[styles.dot, { backgroundColor: FLAG.yellow }]} />
                <View style={[styles.dot, { backgroundColor: FLAG.red }]} />
              </View>
              <Text style={styles.heroGreet}>
                {imageMode ? t('describeImage') : `${greetWord}, ${firstName} 👋`}
              </Text>
              <Text style={styles.heroSub}>
                {imageMode ? 'Describe an image to generate.' : t('emptyHint')}
              </Text>
              </View>
            </ImageBackground>

            {!imageMode && (
              <View style={styles.sugWrap}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s.key} style={[styles.sug, rtlRow(rtl)]} onPress={() => setInput(t(s.key))}>
                    <View style={styles.sugIcon}>
                      <Ionicons name={s.icon} size={17} color={PRIMARY_RED} />
                    </View>
                    <Text style={[styles.sugTxt, rtlText(rtl)]} numberOfLines={2}>{t(s.key)}</Text>
                    <Ionicons name={rtlIcon('arrow-forward', rtl)} size={15} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.ai]}>
            {m.role === 'assistant' && !m.pending && <Text style={styles.who}>{m.image ? 'Image' : 'OZIRA'}</Text>}
            {m.thumb ? <Image source={generatedImageSource(m.thumb, token)} style={styles.thumb} /> : null}
            {m.image ? (
              <Pressable onPress={() => setViewerImage({ url: m.image, id: m.imageId, prompt: m.content, index: i })} accessibilityRole="button" accessibilityLabel="Open generated image">
                <Image source={generatedImageSource(m.image, token)} style={styles.image} resizeMode="cover" />
                {m.content ? <Markdown text={m.content} colors={colors} style={[styles.msgTxt, rtlText(rtl)]} /> : null}
              </Pressable>
            ) : m.pending ? (
              <View style={styles.thinkingRow} accessibilityLabel={t('vThinking')}>
                <Text style={styles.thinkingTxt}>{t('vThinking').replace('…', '')}</Text>
                <ThinkingDots />
              </View>
            ) : m.role === 'assistant' ? (
              // AI answers are markdown — render them as a formatted result,
              // not raw ** and ## in a chat bubble.
              <Markdown text={m.content} colors={colors} style={[styles.msgTxt, rtlText(rtl)]} />
            ) : (
              <Text style={[styles.msgTxt, rtlText(rtl), { color: colors.text }]}>{m.content}</Text>
            )}
            {!m.pending && m.role === 'assistant' && m.metadata?.webBuild ? <WebsiteArtifact artifact={m.metadata.webBuild} colors={colors} /> : null}
            {!m.pending && m.role === 'assistant' && m.metadata?.document ? <DocumentArtifact artifact={m.metadata.document} colors={colors} /> : null}
            {!m.pending && m.content ? (
              <View style={[styles.actionRow, m.role === 'assistant' && styles.assistantActionRow]}>
                {m.role === 'assistant' ? (
                  <>
                    <Pressable onPress={() => copyMsg(m, i)} style={({ pressed }) => [styles.assistantActBtn, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="Copy">
                      <AssistantActionIcon name={copiedIdx === i ? 'check' : 'copy'} size={18} color={copiedIdx === i ? colors.text : colors.muted} />
                    </Pressable>
                    <Pressable onPress={() => onSpeak(i, m)} style={({ pressed }) => [styles.assistantActBtn, speakingIdx === i && styles.assistantActSelected, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="Read aloud" accessibilityState={{ selected: speakingIdx === i, busy: speakBusy === i }}>
                      {speakBusy === i ? (
                        <ActivityIndicator size="small" color={colors.muted} />
                      ) : (
                        <AssistantActionIcon name={speakingIdx === i ? 'stop' : 'volume'} size={18} color={speakingIdx === i ? colors.text : colors.muted} />
                      )}
                    </Pressable>
                    <Pressable onPress={() => react(i, m, 1)} style={({ pressed }) => [styles.assistantActBtn, m.reaction === 1 && styles.assistantActSelected, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="Good response" accessibilityState={{ selected: m.reaction === 1 }}>
                      <AssistantActionIcon name="like" size={18} color={m.reaction === 1 ? colors.text : colors.muted} />
                    </Pressable>
                    <Pressable onPress={() => react(i, m, -1)} style={({ pressed }) => [styles.assistantActBtn, m.reaction === -1 && styles.assistantActSelected, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="Bad response" accessibilityState={{ selected: m.reaction === -1 }}>
                      <AssistantActionIcon name="dislike" size={18} color={m.reaction === -1 ? colors.text : colors.muted} />
                    </Pressable>
                    <Pressable onPress={() => shareMsg(m)} style={({ pressed }) => [styles.assistantActBtn, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="Share">
                      <AssistantActionIcon name="share" size={18} color={colors.muted} />
                    </Pressable>
                    <Pressable onPress={(event) => openAssistantActions(i, m, event)} style={({ pressed }) => [styles.assistantActBtn, pressed && styles.assistantActPressed]} accessibilityRole="button" accessibilityLabel="More">
                      <AssistantActionIcon name="more" size={18} color={colors.muted} />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => copyMsg(m)} style={styles.actBtn}>
                      <Ionicons name="copy-outline" size={18} color={colors.muted} />
                    </Pressable>
                    {!m.thumb && (
                      <Pressable onPress={() => startEdit(i, m)} style={styles.actBtn}>
                        <Ionicons name="pencil-outline" size={18} color={editIdx === i ? colors.primary : colors.muted} />
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: kb > 0 ? 10 : insets.bottom + 8 }]}>
        {recording ? (
          <View style={styles.statusHint}>
            <Text style={[styles.statusHintTxt, { color: colors.danger }]}>● Recording… tap the red button to stop</Text>
          </View>
        ) : transcribing ? (
          <View style={styles.statusHint}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.statusHintTxt, { color: colors.primary }]}>Transcribing your voice…</Text>
          </View>
        ) : imageMode ? (
          <Pressable onPress={() => setImageMode(false)} style={styles.statusHint}>
            <Text style={[styles.statusHintTxt, { color: colors.gold }]}>Create-image mode on - tap to turn off</Text>
            <Ionicons name="close" size={14} color={colors.gold} />
          </Pressable>
        ) : research ? (
          <Pressable onPress={() => setResearch(false)} style={styles.statusHint}>
            <Text style={[styles.statusHintTxt, { color: colors.success }]}>Research mode on - I'll search the web</Text>
            <Ionicons name="close" size={14} color={colors.success} />
          </Pressable>
        ) : null}
        {editIdx != null ? (
          <View style={styles.attachChip}>
            <Ionicons name="pencil" size={14} color={colors.primary} />
            <Text style={styles.attachTxt} numberOfLines={1}>{t('editingMsg')}</Text>
            <Pressable onPress={cancelEdit} hitSlop={8}><Ionicons name="close" size={16} color={colors.muted} /></Pressable>
          </View>
        ) : null}
        {attachment ? (
          <View style={styles.attachChip}>
            <Ionicons name={attachment.kind === 'photo' ? 'image' : 'document-text'} size={15} color={colors.primary} />
            <Text style={styles.attachTxt} numberOfLines={1}>{attachment.name}</Text>
            <Pressable onPress={() => setAttachment(null)} hitSlop={8}><Ionicons name="close" size={16} color={colors.muted} /></Pressable>
          </View>
        ) : null}
        <View style={[styles.inputRow, rtlRow(rtl)]}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.round}>
            <Ionicons name="add" size={24} color={colors.primary} />
          </Pressable>
          <TextInput
            ref={inputRef}
            style={[styles.input, rtlText(rtl)]}
            value={input}
            onChangeText={setInput}
            placeholder={imageMode ? t('describeImage') : t('askPlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
          />
          {busy ? (
            <Pressable onPress={stopGen} style={styles.stopBtn}>
              <Ionicons name="stop" size={18} color={colors.white} />
            </Pressable>
          ) : recording ? (
            <Pressable onPress={stopRec} style={styles.stopBtn}>
              <Ionicons name="stop" size={18} color={colors.white} />
            </Pressable>
          ) : transcribing ? (
            <View style={styles.send}><ActivityIndicator size="small" color={colors.white} /></View>
          ) : (input.trim() || attachment) ? (
            <Pressable onPress={send} style={styles.send}>
              <Ionicons name="arrow-up" size={20} color={colors.white} />
            </Pressable>
          ) : (
            <Pressable onPress={() => setVoiceOpen(true)} style={styles.voiceBtn} accessibilityRole="button" accessibilityLabel="Start live voice conversation">
              <LinearGradient colors={[colors.primary, colors.secondary]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.voiceWave}>
                <Ionicons name="pulse" size={23} color={colors.white} />
              </LinearGradient>
            </Pressable>
          )}
        </View>
        <Text style={styles.disclaimer}>{t('disclaimer')}</Text>
      </View>

      <Modal visible={convMenu} transparent animationType="fade" onRequestClose={() => setConvMenu(false)}>
        <Pressable style={styles.convMenuBg} onPress={() => setConvMenu(false)}>
          <View style={[styles.convMenu, { marginTop: insets.top + 44 }]}>
            <Text style={styles.convHeader}>Conversation options</Text>
            <Pressable style={({ pressed }) => [styles.convItem, pressed && styles.convItemPressed]} onPress={shareConversation}>
              <Ionicons name="share-social-outline" size={18} color={colors.primary} />
              <Text style={styles.convItemTxt}>Share</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.convItem, pressed && styles.convItemPressed]} onPress={togglePin}>
              <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={18} color={pinned ? colors.gold : colors.text} />
              <Text style={styles.convItemTxt}>{pinned ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.convItem, pressed && styles.convItemPressed]} onPress={addToProject}>
              <Ionicons name="folder-outline" size={18} color={colors.primary} />
              <Text style={styles.convItemTxt}>Add to project</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.convItem, pressed && styles.convItemPressed]} onPress={archiveConversation}>
              <Ionicons name="archive-outline" size={18} color={colors.primary} />
              <Text style={styles.convItemTxt}>Archive</Text>
            </Pressable>
            <View style={styles.convDivider} />
            <Pressable style={({ pressed }) => [styles.convItem, pressed && styles.convItemPressed]} onPress={deleteThis}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.convItemTxt, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!assistantMenu} transparent animationType="fade" onRequestClose={() => setAssistantMenu(null)}>
        <Pressable style={styles.actionMenuBackdrop} onPress={() => setAssistantMenu(null)}>
          <View style={[
            styles.actionMenu,
            {
              right: Math.max(12, Math.min(windowWidth - 232, windowWidth - (assistantMenu?.pageX ?? windowWidth - 34) - 22)),
              top: (() => {
                const anchorY = assistantMenu?.pageY ?? (windowHeight / 2);
                const below = anchorY + 24;
                return below + 106 <= windowHeight - insets.bottom
                  ? below
                  : Math.max(insets.top + 8, anchorY - 130);
              })(),
            },
          ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Regenerate answer"
              style={({ pressed }) => [styles.actionMenuItem, pressed && styles.convItemPressed]}
              onPress={() => {
                const index = assistantMenu?.index;
                setAssistantMenu(null);
                if (index != null) regenerate(index);
              }}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.text} />
              <Text style={styles.actionMenuText}>Regenerate answer</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search the web"
              style={({ pressed }) => [styles.actionMenuItem, pressed && styles.convItemPressed]}
              onPress={() => {
                const message = assistantMenu?.message;
                setAssistantMenu(null);
                if (message) webSearch(message);
              }}
            >
              <Ionicons name="globe-outline" size={18} color={colors.text} />
              <Text style={styles.actionMenuText}>Search the web</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!folderPick} transparent animationType="fade" onRequestClose={() => setFolderPick(null)}>
        <Pressable style={styles.convMenuBg} onPress={() => setFolderPick(null)}>
          <View style={[styles.convMenu, { marginTop: insets.top + 44 }]}>
            <Text style={styles.convHeader}>Add to project</Text>
            {(folderPick || []).map(f => (
              <Pressable key={f.id} style={styles.convItem} onPress={() => pickFolder(f.id)}>
                <Ionicons name="folder" size={18} color={colors.gold} />
                <Text style={styles.convItemTxt}>{f.name}</Text>
              </Pressable>
            ))}
            <View style={styles.convDivider} />
            <Pressable style={styles.convItem} onPress={() => pickFolder(null)}>
              <Ionicons name="remove-circle-outline" size={18} color={colors.muted} />
              <Text style={[styles.convItemTxt, { color: colors.muted }]}>No project</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!viewerImage} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setViewerImage(null)}>
        <View style={styles.imageViewer}>
          <View style={[styles.imageViewerTop, { paddingTop: insets.top + 8 }]}>
            <Pressable style={styles.viewerIconBtn} onPress={() => setViewerImage(null)} accessibilityRole="button" accessibilityLabel="Close image">
              <Ionicons name="close" size={25} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.imageViewerTitle}>{t('notifImageReady')}</Text>
            <View style={styles.viewerTopActions}>
              <Pressable style={styles.viewerIconBtn} onPress={() => shareGeneratedImage(viewerImage?.url)} accessibilityRole="button" accessibilityLabel="Share image">
                <Ionicons name="share-outline" size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable
                style={[styles.viewerSaveBtn, imageSaved && styles.viewerSaveBtnDone]}
                onPress={() => saveGeneratedImage(viewerImage?.url)}
                disabled={savingImage}
                accessibilityRole="button"
                accessibilityLabel={imageSaved ? t('notifSaved') : t('saveImage')}
              >
                {savingImage
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Ionicons name={imageSaved ? 'checkmark-circle' : 'download-outline'} size={20} color="#FFFFFF" />}
                {!savingImage && <Text style={styles.viewerSaveTxt}>{imageSaved ? t('notifSaved') : t('saveImage')}</Text>}
              </Pressable>
            </View>
          </View>
          <View style={styles.imageViewerBody}>
            {!!viewerImage?.url && <Image source={generatedImageSource(viewerImage.url, token)} style={styles.imageViewerImage} resizeMode="contain" />}
            {imageSaved && (
              <View pointerEvents="none" style={styles.viewerSavedBadge}>
                <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                <Text style={styles.viewerSavedBadgeTxt}>{t('savedToPhotos')}</Text>
              </View>
            )}
            <View style={[styles.viewerTools, { bottom: Math.max(insets.bottom + 28, 62) }]}>
              <Pressable style={styles.viewerTool} onPress={() => beginImageEdit(viewerImage, t('editImagePrompt'))}><Ionicons name="pencil-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('editImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => beginImageEdit(viewerImage)}><Ionicons name="chatbubble-ellipses-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('commentImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => { setResizeImage(viewerImage); setViewerImage(null); }}><Ionicons name="resize-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('resizeImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => beginImageEdit(viewerImage, t('removeBackgroundPrompt'), { operation: 'remove_background' })}><Ionicons name="cut-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('removeBackground')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => removeGeneratedImage(viewerImage, viewerImage?.index)}><Ionicons name="trash-outline" size={14} color="#FF8B91" /><Text style={[styles.viewerToolTxt, { color: '#FFB0B4' }]}>{t('remove')}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!resizeImage} transparent animationType="fade" onRequestClose={() => setResizeImage(null)}>
        <Pressable style={styles.resizeBackdrop} onPress={() => setResizeImage(null)}>
          <View style={styles.resizeCard}>
            <Text style={styles.resizeTitle}>{t('chooseFrame')}</Text>
            <View style={styles.resizeChoices}>
              {[
                { size: '1024x1024', key: 'square', style: { width: 62, height: 62 } },
                { size: '1024x1536', key: 'portrait', style: { width: 46, height: 68 } },
                { size: '1536x1024', key: 'landscape', style: { width: 76, height: 50 } },
              ].map(frame => (
                <Pressable key={frame.size} style={styles.resizeChoice} onPress={() => beginImageEdit(resizeImage, t('resizePrompt'), { size: frame.size })}>
                  <View style={[styles.framePreview, frame.style]} />
                  <Text style={styles.resizeChoiceTxt}>{t(frame.key)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Attachment sheet — a plain in-tree overlay, NOT a <Modal>. This screen
          already stacks several Modals; on Android extra ones can fail to show
          or swallow taps, and a native picker can't launch while one dismisses. */}
      {menuOpen && (
        <View style={styles.menuBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(false)} />
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.menuHandle} />
            {MENU.map(item => (
              <Pressable key={item.key} style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]} onPress={() => onMenu(item.key)}>
                <View style={styles.menuIcon}>
                  <Ionicons name={item.icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuSub}>{item.sub}</Text>
                </View>
                {item.soon ? <Text style={styles.soon}>Soon</Text> : <Ionicons name="chevron-forward" size={16} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <VoiceOverlay
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        token={token}
        lang={lang}
        userName={firstName}
        getHistory={voiceHistory}
        onExchange={appendVoiceExchange}
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  modeSel: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8,
    backgroundColor: colors.primary + '10', borderWidth: 1, borderColor: colors.border,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  modeSelTxt: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  modeDrop: {
    position: 'absolute', top: 0, left: 12, zIndex: 50, marginTop: 92,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 5, width: 236, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 9,
  },
  modeDismiss: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 49 },
  dropLabel: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 10.5, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 3, textTransform: 'uppercase' },
  dropDivider: { height: 1, backgroundColor: colors.primary + '44', marginVertical: 2 },
  modeDropRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 9 },
  modeDropOn: { backgroundColor: colors.primary + '16' },
  modeDropTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  modeDropSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, marginTop: 2 },
  // Matches the web action row's density (18px glyphs, 2px apart, 6px above the
  // row) while keeping 44px hit areas: 32px would read the same but sits under
  // the 44px minimum touch target both platforms recommend, and there are six
  // of these side by side.
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6, alignSelf: 'flex-start' },
  assistantActionRow: { gap: 2, marginTop: 6, alignSelf: 'flex-start' },
  actBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  assistantActBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: 'transparent' },
  assistantActPressed: { backgroundColor: colors.border + '88' },
  assistantActSelected: { backgroundColor: colors.border + '66' },
  actionMenuBackdrop: { flex: 1, backgroundColor: 'transparent' },
  actionMenu: {
    position: 'absolute', width: 220, backgroundColor: colors.surface, borderRadius: 12, padding: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 9,
  },
  actionMenuItem: { minHeight: 44, paddingHorizontal: 11, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionMenuText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  moreBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  convMenuBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.26)', alignItems: 'flex-end', paddingRight: 12 },
  convMenu: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, paddingVertical: 7, width: 236,
    shadowColor: '#000', shadowOpacity: 0.20, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 9,
  },
  convHeader: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 15, paddingVertical: 9 },
  convItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12, marginHorizontal: 5, borderRadius: 10 },
  convItemPressed: { backgroundColor: colors.primary + '12' },
  convItemTxt: { color: colors.text, fontFamily: fonts.medium, fontSize: 14.5 },
  convDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  empty: { marginTop: 18, gap: 18 },
  hero: {
    backgroundColor: '#250914', borderRadius: 26, overflow: 'hidden',
  },
  heroArt: { opacity: 0.92 },
  heroInner: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 22, gap: 11, backgroundColor: 'rgba(28,5,16,0.18)' },
  heroLogo: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  triDots: { flexDirection: 'row', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  heroGreet: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 21, textAlign: 'center' },
  heroSub: { color: 'rgba(255,255,255,0.82)', fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  sugWrap: { gap: 10 },
  sug: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14,
  },
  sugIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  sugTxt: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 14.5 },
  greet: { color: colors.text, fontFamily: fonts.bold, fontSize: 20, textAlign: 'center' },
  emptyTxt: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14.5, textAlign: 'center' },
  bubble: { maxWidth: '86%', padding: 12, borderRadius: 16, marginBottom: 12 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.card, borderBottomRightRadius: 4 },
  ai: {
    alignSelf: 'stretch', maxWidth: '100%', backgroundColor: 'transparent', borderWidth: 0,
    paddingHorizontal: 2, paddingVertical: 8,
  },
  who: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 11.5, marginBottom: 5 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  thinkingTxt: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  msgTxt: { color: colors.text, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  speakBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' },
  speakTxt: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  image: { width: 240, height: 240, borderRadius: 12 },
  imageViewer: { flex: 1, backgroundColor: '#050507' },
  imageViewerTop: {
    minHeight: 68, paddingHorizontal: 14, paddingBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(5,5,7,0.96)', borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.13)',
  },
  imageViewerTitle: { flex: 1, color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 15 },
  viewerTopActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerIconBtn: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  viewerSaveBtn: {
    minWidth: 86, height: 42, paddingHorizontal: 13, borderRadius: 21,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: colors.primary,
  },
  viewerSaveBtnDone: { backgroundColor: '#078930' },
  viewerSaveTxt: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
  imageViewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10 },
  imageViewerImage: { width: '100%', height: '100%' },
  viewerTools: {
    position: 'absolute', left: 10, right: 10,
    minHeight: 42, paddingHorizontal: 5, paddingVertical: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderRadius: 18, backgroundColor: 'rgba(10,10,14,0.78)',
  },
  viewerTool: { minWidth: 43, maxWidth: 58, height: 33, paddingHorizontal: 3, borderRadius: 9, alignItems: 'center', justifyContent: 'center', gap: 0 },
  viewerToolTxt: { color: '#FFFFFF', fontFamily: fonts.medium, fontSize: 7.5, textAlign: 'center' },
  resizeBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  resizeCard: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  resizeTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 17, marginBottom: 18 },
  resizeChoices: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  resizeChoice: { width: 94, minHeight: 110, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 9 },
  framePreview: { borderWidth: 2, borderColor: colors.primary, borderRadius: 8, backgroundColor: colors.primary + '12' },
  resizeChoiceTxt: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12 },
  viewerSavedBadge: {
    position: 'absolute', bottom: 28, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 17, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(7,137,48,0.96)',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  viewerSavedBadgeTxt: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 14 },
  composer: {
    paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.bg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  imgHint: { color: colors.primary, fontFamily: fonts.medium, fontSize: 12, marginBottom: 6, marginLeft: 6 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginLeft: 2 },
  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  modePillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  modePillOnSmart: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeTxt: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  modeHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 10.5, flex: 1, marginLeft: 4 },
  statusHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginLeft: 4 },
  statusHintTxt: { fontFamily: fonts.medium, fontSize: 12 },
  thumb: { width: 150, height: 150, borderRadius: 10, marginBottom: 6 },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 999, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, marginBottom: 8, maxWidth: '80%',
  },
  attachTxt: { color: colors.text, fontFamily: fonts.medium, fontSize: 12.5, flexShrink: 1 },
  menuBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', zIndex: 50,
    ...(Platform.OS === 'android' ? { elevation: 50 } : null),
  },
  menuSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.primary, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 12, paddingTop: 10 },
  menuHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.primary + '66', alignSelf: 'center', marginBottom: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 9, borderRadius: radius.md },
  menuItemPressed: { backgroundColor: colors.primary + '12' },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary + '14' },
  menuLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  menuSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  soon: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, backgroundColor: colors.card, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  round: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '12',
    borderWidth: 1, borderColor: colors.primary + '55', alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15,
  },
  send: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  voiceBtn: {
    width: 48, height: 48, borderRadius: 24, overflow: 'hidden', elevation: 4,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  voiceWave: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stopBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  disclaimer: {
    color: colors.muted, fontFamily: fonts.regular, fontSize: 10.5,
    textAlign: 'center', marginTop: 8, paddingHorizontal: 20, lineHeight: 14,
  },
});
