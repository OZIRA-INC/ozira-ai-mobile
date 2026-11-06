import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ImageBackground } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';
import { useColors } from '../context/ThemeContext';
import Logo from '../components/Logo';
import FlagMenu from '../components/FlagMenu';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { listConversations, newId, getProfile, setProfile as saveProfile } from '../localStore';
import { zodiacFor } from '../zodiac';
import { ethiopianDateString } from '../ethiopianDate';
import { api } from '../api';

const QUICK = [
  { key: 'travel', title: 'Travel', sub: 'Plan your trip', icon: 'airplane', color: colors.accent, route: 'Travel' },
  { key: 'tools', title: 'AI Tools', sub: 'Boost productivity', icon: 'grid', color: colors.secondary, route: 'Tools' },
];

export default function ChatHomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, token } = useAuth();
  const { openSidebar } = useUI();
  const [recent, setRecent] = useState([]);
  const [profile, setProfileState] = useState({});
  const [horoscope, setHoroscope] = useState('');

  useFocusEffect(useCallback(() => {
    (async () => {
      try { setRecent((await listConversations()).slice(0, 6)); } catch (_) {}
      try { const p = await getProfile(); setProfileState(p); maybeHoroscope(p); } catch (_) {}
    })();
  }, []));

  async function maybeHoroscope(p) {
    if (!p || p.showZodiac === false) { setHoroscope(''); return; }
    const z = zodiacFor(p.birthday);
    if (!z) { setHoroscope(''); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (p.horoscope && p.horoscope.date === today && p.horoscope.sign === z.name) { setHoroscope(p.horoscope.text); return; }
    setHoroscope('Reading the stars…');
    try {
      const prompt = 'Write a short, warm, positive daily horoscope for ' + z.name + ' for today. Two sentences, general and encouraging. No preamble.';
      const d = await api.chat({ model: 'auto', tier: 'fast', effort: 'quick', skill: 'general', messages: [{ role: 'user', content: prompt }] }, token);
      const text = (d.reply || '').trim();
      if (text) { setHoroscope(text); await saveProfile({ horoscope: { date: today, sign: z.name, text } }); }
    } catch (_) { setHoroscope(''); }
  }

  function newChat() {
    navigation.navigate('ChatConversation', { conversationId: newId(), title: 'New Chat' });
  }

  const zodiac = zodiacFor(profile.birthday);
  const firstName = (user?.name || 'there').split(' ')[0];
  const isBirthday = (() => {
    if (!profile.birthday || profile.birthday.length < 10) return false;
    const t = new Date();
    const md = String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    return profile.birthday.slice(5) === md;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <FlagMenu onPress={openSidebar} size={24} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Logo size={24} />
          <Text style={styles.brand}>OZIRA <Text style={{ color: colors.primary }}>AI</Text></Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.hello}>Hello, {user?.name?.split(' ')[0] || 'there'}</Text>
        <Text style={styles.helloSub}>How can I help you today?</Text>

        <ImageBackground source={require('../../assets/sidebar-artistic-gradient.png')} style={styles.dayCard} imageStyle={styles.dayCardArt}>
          <View style={styles.dayCardOverlay}>
            <Text style={styles.dayDate}>🗓  {ethiopianDateString()} · Ethiopian calendar</Text>
            {isBirthday ? <Text style={styles.bday}>🎉 Happy birthday, {firstName}! Wishing you a wonderful year.</Text> : null}
            {profile.showZodiac !== false && zodiac ? (
              <View style={styles.horo}>
                <Text style={styles.horoSign}>{zodiac.emoji}  {zodiac.name} · today</Text>
                <Text style={styles.horoTxt}>{horoscope || 'Set your birthday in Profile to see your daily horoscope.'}</Text>
              </View>
            ) : null}
          </View>
        </ImageBackground>

        <View style={styles.grid}>
          {QUICK.map(q => (
            <Pressable key={q.key} style={styles.tile} onPress={() => navigation.navigate(q.route)}>
              <View style={[styles.tileIcon, { backgroundColor: q.color + '22' }]}>
                <Ionicons name={q.icon} size={20} color={q.color} />
              </View>
              <Text style={styles.tileTitle}>{q.title}</Text>
              <Text style={styles.tileSub}>{q.sub}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>Recent Chats</Text>
        {recent.length === 0 ? (
          <Text style={styles.empty}>No chats yet. Tap a card above to start.</Text>
        ) : recent.map(c => (
          <Pressable key={c.id} style={styles.recent} onPress={() => navigation.navigate('ChatConversation', { conversationId: c.id, title: c.title, projectId: c.projectId || null })}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.muted} />
            <Text style={styles.recentTxt} numberOfLines={1}>{c.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 18 }]} onPress={newChat}>
        <Ionicons name="add" size={26} color={colors.white} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  brand: { color: colors.text, fontFamily: fonts.bold, fontSize: 18 },
  hello: { color: colors.text, fontFamily: fonts.bold, fontSize: 24 },
  helloSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14.5, marginTop: 4, marginBottom: 18 },
  dayCard: { backgroundColor: '#250914', borderWidth: 1, borderColor: colors.primary + '66', borderRadius: radius.lg, marginBottom: 18, overflow: 'hidden' },
  dayCardArt: { opacity: 0.82 },
  dayCardOverlay: { padding: 14, backgroundColor: 'rgba(27,5,15,0.30)' },
  dayDate: { color: colors.white, fontFamily: fonts.medium, fontSize: 13.5 },
  bday: { color: colors.gold, fontFamily: fonts.semibold, fontSize: 13.5, marginTop: 8 },
  horo: { marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.24)', paddingTop: 10 },
  horoSign: { color: '#FFD76A', fontFamily: fonts.semibold, fontSize: 13 },
  horoTxt: { color: 'rgba(255,255,255,0.82)', fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47%', flexGrow: 1, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border,
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  tileTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  tileSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  section: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, marginTop: 24, marginBottom: 10 },
  empty: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13.5 },
  recent: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  recentTxt: { color: colors.text, fontFamily: fonts.regular, fontSize: 14, flex: 1 },
  fab: {
    position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6,
  },
});
