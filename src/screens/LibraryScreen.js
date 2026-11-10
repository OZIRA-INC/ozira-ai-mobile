import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, ActivityIndicator, Dimensions, Modal, Alert, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';
import { useColors } from '../context/ThemeContext';
import FlagMenu from '../components/FlagMenu';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api, absUrl, generatedImageSource, downloadGeneratedImage } from '../api';
import { useLang } from '../context/LanguageContext';
import { useNotify } from '../context/NotifyContext';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { shareArtifactFile } from '../artifactFiles';
import { conversationSessionLease } from '../localStore';

const GAP = 10;
const COL_W = (Dimensions.get('window').width - 32 - GAP) / 2;

export default function LibraryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { token } = useAuth();
  const { t } = useLang();
  const { notify } = useNotify();
  const { openSidebar } = useUI();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // 'all' | 'images' | 'files'
  const [viewer, setViewer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resizeImage, setResizeImage] = useState(null);

  async function load() {
    try { const d = await api.images(token); setImages(d.images || []); } catch (_) {}
    setLoading(false);
  }
  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [navigation]);

  function openInEditor(image, prompt = '', options = {}) {
    if (!image) return;
    setViewer(null);
    setResizeImage(null);
    navigation.navigate('ChatConversation', {
      imageMode: true,
      title: 'Image Editor',
      sourceImage: absUrl(image.url),
      sourceImageId: image.id,
      editPrompt: prompt,
      imageOperation: options.operation,
      imageSize: options.size,
    });
  }

  async function saveImage(image) {
    if (!image || saving) return;
    setSaving(true);
    try {
      const uri = absUrl(image.url);
      const current = conversationSessionLease();
      const downloaded = await downloadGeneratedImage(uri, token);
      if (!current()) return;
      const target = new File(Paths.cache, `${Date.now()}-${downloaded.fileName}`);
      target.create(); target.write(downloaded.bytes);
      try { await MediaLibrary.saveToLibraryAsync(target.uri); }
      finally { try { target.delete(); } catch (_) {} }
      if (!current()) return;
      notify(t('savedToPhotos'), '', 'success');
    } catch (e) {
      Alert.alert(t('saveImage'), e.message || t('notifFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function shareImage(image) {
    if (!image) return;
    try {
      const current = conversationSessionLease();
      const downloaded = await downloadGeneratedImage(image.url, token);
      if (current()) await shareArtifactFile(downloaded.fileName, downloaded.bytes, downloaded.mimeType, current);
    } catch (_) {}
  }

  function removeImage(image) {
    Alert.alert(t('removeImage'), t('removeImageConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'), style: 'destructive', onPress: async () => {
          try {
            await api.deleteImage({ id: image.id, url: image.url }, token);
            setViewer(null);
            setImages(prev => prev.filter(item => item.id !== image.id));
            notify(t('imageRemoved'), '', 'success');
          } catch (e) {
            Alert.alert(t('removeImage'), e.message || t('notifFailed'));
          }
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <FlagMenu onPress={openSidebar} size={24} />
        <Text style={styles.title}>Library</Text>
        <Pressable onPress={() => navigation.navigate('ChatConversation', { imageMode: true, title: 'Image Generator' })} hitSlop={10}>
          <Ionicons name="add" size={26} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {['all', 'images', 'files'].map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabTxt, tab === t && { color: colors.primary }]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'files' ? (
        <View style={styles.empty}>
          <Ionicons name="document-outline" size={44} color={colors.muted} />
          <Text style={styles.emptyTxt}>File storage is coming soon. Documents you attach in chat aren't saved to your library yet.</Text>
        </View>
      ) : loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        images.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={44} color={colors.muted} />
            <Text style={styles.emptyTxt}>No images yet. Generate one and it will be saved here.</Text>
            <Pressable style={styles.genBtn} onPress={() => navigation.navigate('ChatConversation', { imageMode: true, title: 'Image Generator' })}>
              <Ionicons name="color-palette" size={17} color={colors.white} />
              <Text style={styles.genTxt}>Create an image</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>
            <View style={styles.grid}>
              {images.map(img => (
                <Pressable key={img.id} style={styles.cell} onPress={() => setViewer(img)} accessibilityRole="button" accessibilityLabel="Open saved image">
                  <Image source={generatedImageSource(img.url, token)} style={styles.img} resizeMode="cover" />
                  {img.prompt ? <Text style={styles.caption} numberOfLines={2}>{img.prompt}</Text> : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )
      )}

      <Modal visible={!!viewer} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          <View style={[styles.viewerTop, { paddingTop: insets.top + 8 }]}>
            <Pressable style={styles.viewerIcon} onPress={() => setViewer(null)}><Ionicons name="close" size={25} color="#FFFFFF" /></Pressable>
            <Text style={styles.viewerTitle} numberOfLines={1}>{viewer?.prompt || t('notifImageReady')}</Text>
            <Pressable style={styles.viewerIcon} onPress={() => shareImage(viewer)}><Ionicons name="share-outline" size={22} color="#FFFFFF" /></Pressable>
            <Pressable style={styles.saveBtn} onPress={() => saveImage(viewer)} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="download-outline" size={20} color="#FFFFFF" />}
              {!saving && <Text style={styles.saveTxt}>{t('saveImage')}</Text>}
            </Pressable>
          </View>
          <View style={styles.viewerBody}>
            {!!viewer && <Image source={generatedImageSource(viewer.url, token)} style={styles.viewerImage} resizeMode="contain" />}
            <View style={[styles.viewerTools, { bottom: Math.max(insets.bottom + 28, 62) }]}>
              <Pressable style={styles.viewerTool} onPress={() => openInEditor(viewer, t('editImagePrompt'))}><Ionicons name="pencil-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('editImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => openInEditor(viewer)}><Ionicons name="chatbubble-ellipses-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('commentImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => { setResizeImage(viewer); setViewer(null); }}><Ionicons name="resize-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('resizeImage')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => openInEditor(viewer, t('removeBackgroundPrompt'), { operation: 'remove_background' })}><Ionicons name="cut-outline" size={14} color="#FFFFFF" /><Text style={styles.viewerToolTxt}>{t('removeBackground')}</Text></Pressable>
              <Pressable style={styles.viewerTool} onPress={() => removeImage(viewer)}><Ionicons name="trash-outline" size={14} color="#FF8B91" /><Text style={[styles.viewerToolTxt, { color: '#FFB0B4' }]}>{t('remove')}</Text></Pressable>
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
                <Pressable key={frame.size} style={styles.resizeChoice} onPress={() => openInEditor(resizeImage, t('resizePrompt'), { size: frame.size })}>
                  <View style={[styles.framePreview, frame.style]} />
                  <Text style={styles.resizeChoiceTxt}>{t(frame.key)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 17 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabOn: { borderColor: colors.primary },
  tabTxt: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  empty: { alignItems: 'center', marginTop: 90, gap: 14, paddingHorizontal: 40 },
  emptyTxt: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  genBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11 },
  genTxt: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { width: COL_W, marginBottom: GAP },
  img: { width: COL_W, height: COL_W, borderRadius: radius.md, backgroundColor: colors.surface },
  caption: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 5, lineHeight: 15 },
  viewer: { flex: 1, backgroundColor: '#050507' },
  viewerTop: { minHeight: 68, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(5,5,7,0.96)' },
  viewerTitle: { flex: 1, color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 14 },
  viewerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)' },
  saveBtn: { height: 42, paddingHorizontal: 13, borderRadius: 21, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary },
  saveTxt: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
  viewerBody: { flex: 1, padding: 10, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
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
});
