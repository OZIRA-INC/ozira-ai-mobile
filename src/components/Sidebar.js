// Red overlay drawer: slides in from the left over the app, with a dim backdrop.
// Plain built-in Animated (no Reanimated), and it does NOT transform the app
// content — that was crashing Android.
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Animated, Dimensions, TextInput, Modal, Alert, Image, ImageBackground, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, radius } from '../theme';
import { useColors } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useLang } from '../context/LanguageContext';
import { rtlText, rtlRow, rtlIcon } from '../i18n';
import Logo from './Logo';
import { navigate } from '../navigation/navigationRef';
import { listConversations, listFolders, createFolder, deleteFolder, deleteConversation, setConversationFolder, setConversationMeta, newId, getProfile } from '../localStore';
import { zodiacFor } from '../zodiac';

const WIDTH = Math.min(320, Dimensions.get('window').width * 0.84);

const RED = '#B3121B';
const ON = '#FFFFFF';
const DIM = 'rgba(255,255,255,0.72)';
const CARD = 'rgba(255,255,255,0.12)';
const CARD_ON = 'rgba(255,255,255,0.22)';
const LINE = 'rgba(255,255,255,0.18)';

export default function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUI();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, token } = useAuth();
  const { t, rtl } = useLang();
  const tx = useRef(new Animated.Value(-WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const openRef = useRef(sidebarOpen); openRef.current = sidebarOpen;
  const closeRef = useRef(closeSidebar); closeRef.current = closeSidebar;
  const [convs, setConvs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [moveConv, setMoveConv] = useState(null);
  const [profile, setProfileState] = useState({});

  // A real curtain-like drawer: the user can pull it closed and release at
  // any position. Small drags spring back; a decisive drag completes the close.
  const drawerPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => openRef.current && gesture.dx < -6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { tx.stopAnimation(); fade.stopAnimation(); },
    onPanResponderMove: (_event, gesture) => {
      const next = Math.max(-WIDTH, Math.min(0, gesture.dx));
      tx.setValue(next);
      fade.setValue(1 + next / WIDTH);
    },
    onPanResponderRelease: (_event, gesture) => {
      const shouldClose = gesture.dx < -WIDTH * 0.30 || gesture.vx < -0.35;
      if (shouldClose) closeRef.current();
      else Animated.parallel([
        Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
        Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    },
    onPanResponderTerminate: () => Animated.parallel([
      Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
      Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start(),
  })).current;

  const refresh = useCallback(async () => {
    try {
      setFolders(await listFolders());
      setConvs(activeFolder === '__archived'
        ? await listConversations(null, { archived: true })
        : await listConversations(activeFolder));
      setProfileState(await getProfile());
    } catch (_) {}
  }, [activeFolder, token]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(tx, { toValue: sidebarOpen ? 0 : -WIDTH, duration: 240, useNativeDriver: true }),
      Animated.timing(fade, { toValue: sidebarOpen ? 1 : 0, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [sidebarOpen]);

  // The drawer may already be open while Supabase restores the session. The
  // first request then has no Authorization header and returns an empty list.
  // Because refresh depends on token, this effect reruns when it arrives — no
  // reload is needed.
  useEffect(() => { if (sidebarOpen) refresh(); }, [sidebarOpen, refresh]);

  function go(route, params) { navigate(route, params); closeSidebar(); }
  function newChat() { go('ChatConversation', { conversationId: newId(), title: 'New Chat' }); }
  function openChat(c) { go('ChatConversation', { conversationId: c.id, title: c.title, projectId: c.projectId || null }); }

  async function addFolder() {
    const n = folderName.trim();
    if (!n) return;
    await createFolder(n);
    setFolderName(''); setCreateOpen(false); refresh();
  }
  function removeFolder(f) {
    Alert.alert('Delete folder', 'Delete "' + f.name + '"? Chats inside are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { if (activeFolder === f.id) setActiveFolder(null); await deleteFolder(f.id); refresh(); } },
    ]);
  }
  function onLongConv(c) {
    Alert.alert(c.title || 'Chat', undefined, [
      { text: c.pinned ? 'Unpin' : 'Pin', onPress: async () => { await setConversationMeta(c.id, { pinned: !c.pinned }); refresh(); } },
      { text: c.archived ? 'Unarchive' : 'Archive', onPress: async () => { await setConversationMeta(c.id, { archived: !c.archived }); refresh(); } },
      folders.length ? { text: 'Move to folder…', onPress: () => setMoveConv(c) } : null,
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteConversation(c.id); refresh(); } },
      { text: 'Cancel', style: 'cancel' },
    ].filter(Boolean));
  }
  async function moveTo(folderId) {
    if (moveConv) { await setConversationFolder(moveConv.id, folderId); setMoveConv(null); refresh(); }
  }

  // Gender comes from sign-up; it may live on the local profile or in the
  // Supabase user metadata, so check both.
  const gender = (profile.gender || user?.gender || '').toLowerCase();
  const genderIcon = gender === 'female' ? 'woman' : gender === 'male' ? 'man' : 'person';
  const zodiac = profile.showZodiac !== false ? zodiacFor(profile.birthday) : null;

  return (
    <View
      pointerEvents={sidebarOpen ? 'auto' : 'none'}
      collapsable={false}
      style={[StyleSheet.absoluteFillObject, styles.overlayRoot]}
    >
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={{ flex: 1 }} onPress={closeSidebar} />
      </Animated.View>

      <Animated.View {...drawerPan.panHandlers} style={[styles.panel, { width: WIDTH, paddingTop: insets.top + 8, transform: [{ translateX: tx }] }]}>
        <ImageBackground source={require('../../assets/sidebar-artistic-gradient.png')} style={styles.panelImage} imageStyle={styles.panelImageArt}>
        <LinearGradient pointerEvents="none" colors={['rgba(8,2,7,0)', 'rgba(8,2,7,0.78)']} locations={[0, 1]} style={styles.bottomShade} />
        <View style={styles.panelContent}>
        <View style={styles.topRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.logoDot}><Logo size={22} /></View>
            <Text style={styles.brand}>OZIRA AI</Text>
          </View>
          {/* Profile icon replaces the old ✕ — tap it for settings. The drawer
              still closes by tapping the dim backdrop. */}
          <Pressable onPress={() => go('Menu')} hitSlop={10}>
            {profile.avatar
              ? <Image source={{ uri: profile.avatar }} style={styles.avatar} />
              : <View style={styles.avatar}><Ionicons name={genderIcon} size={20} color={RED} /></View>}
          </Pressable>
        </View>

        <Pressable onPress={newChat} style={styles.newChat}>
          <Ionicons name="create-outline" size={18} color={RED} />
          <Text style={styles.newChatTxt}>{t('newChat')}</Text>
        </Pressable>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, marginTop: 6 }}>
          <View style={styles.sectionRow}>
            <Text style={[styles.section, rtlText(rtl)]}>{t('folders')}</Text>
            <Pressable onPress={() => setCreateOpen(true)} hitSlop={8}><Ionicons name="add-circle-outline" size={20} color={ON} /></Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            <Pressable onPress={() => setActiveFolder(null)} style={[styles.chip, !activeFolder && styles.chipOn]}>
              <Text style={styles.chipTxt}>{t('all')}</Text>
            </Pressable>
            {folders.map(f => (
              <Pressable key={f.id} onPress={() => setActiveFolder(f.id)} onLongPress={() => removeFolder(f)} style={[styles.chip, activeFolder === f.id && styles.chipOn]}>
                <Ionicons name="folder" size={12} color={ON} />
                <Text style={styles.chipTxt}>{f.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[styles.section, rtlText(rtl), { marginTop: 16 }]}>{t('chats')}</Text>
          {convs.length === 0 ? (
            <Text style={[styles.empty, rtlText(rtl)]}>{t('noChats')}</Text>
          ) : convs.map(c => (
            <Pressable key={c.id} onPress={() => openChat(c)} onLongPress={() => onLongConv(c)} style={[styles.row, rtlRow(rtl)]}>
              <Ionicons name={c.pinned ? 'bookmark' : 'chatbubble-ellipses-outline'} size={18} color={ON} />
              <Text style={[styles.rowTxt, rtlText(rtl)]} numberOfLines={1}>{c.title || 'New chat'}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable style={styles.upgrade} onPress={() => go('Plans')}>
          <Ionicons name="star" size={16} color={RED} />
          <Text style={styles.upgradeTxt}>{t('upgrade')}</Text>
        </Pressable>

        {/* The profile icon now sits in the top-right, so no duplicate row here.
            Zodiac (opt-in) still gets a quiet line. Log out is in Settings. */}
        {zodiac ? (
          <Text style={[styles.sub, rtlText(rtl), { paddingTop: 10, borderTopWidth: 1, borderTopColor: LINE }]} numberOfLines={1}>
            {zodiac.emoji} {zodiac.name}
          </Text>
        ) : null}
        <View style={{ height: insets.bottom + 6 }} />
        </View>
        </ImageBackground>
      </Animated.View>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setCreateOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New folder</Text>
            <TextInput style={styles.modalInput} value={folderName} onChangeText={setFolderName} placeholder="Folder name" placeholderTextColor={colors.muted} autoFocus />
            <Pressable style={styles.modalBtn} onPress={addFolder}><Text style={styles.modalBtnTxt}>Create</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!moveConv} transparent animationType="fade" onRequestClose={() => setMoveConv(null)}>
        <Pressable style={styles.modalBg} onPress={() => setMoveConv(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Move to folder</Text>
            <Pressable style={styles.moveRow} onPress={() => moveTo(null)}><Ionicons name="remove-circle-outline" size={18} color={colors.muted} /><Text style={styles.moveTxt}>No folder</Text></Pressable>
            {folders.map(f => (
              <Pressable key={f.id} style={styles.moveRow} onPress={() => moveTo(f.id)}><Ionicons name="folder" size={18} color={colors.gold} /><Text style={styles.moveTxt}>{f.name}</Text></Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlayRoot: { zIndex: 1000, elevation: 1000 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: '#210913', overflow: 'hidden' },
  panelImage: { flex: 1 },
  panelImageArt: { opacity: 0.94 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 245 },
  panelContent: { flex: 1, paddingHorizontal: 16, backgroundColor: 'rgba(20,4,13,0.16)' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  logoDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: ON, alignItems: 'center', justifyContent: 'center' },
  brand: { color: ON, fontFamily: fonts.bold, fontSize: 18 },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: ON, borderRadius: 999, paddingVertical: 11, marginTop: 12 },
  newChatTxt: { color: RED, fontFamily: fonts.semibold, fontSize: 14 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  section: { color: DIM, fontFamily: fonts.semibold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: CARD, borderWidth: 1, borderColor: LINE, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: CARD_ON },
  chipTxt: { color: ON, fontFamily: fonts.medium, fontSize: 12.5 },
  empty: { color: DIM, fontFamily: fonts.regular, fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, marginTop: 2 },
  rowTxt: { color: ON, fontFamily: fonts.regular, fontSize: 14.5, flex: 1 },
  upgrade: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ON, borderRadius: radius.md, paddingVertical: 11, marginVertical: 8 },
  upgradeTxt: { color: RED, fontFamily: fonts.semibold, fontSize: 13.5 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: ON, alignItems: 'center', justifyContent: 'center' },
  sub: { color: DIM, fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 30 },
  modalCard: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 18 },
  modalTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, marginBottom: 12 },
  modalInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, height: 46, color: colors.text, fontFamily: fonts.regular, fontSize: 15, marginBottom: 12 },
  modalBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' },
  modalBtnTxt: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  moveTxt: { color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
});
