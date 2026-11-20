import React from 'react';
import { View, Text, Pressable, Linking, Share, Alert } from 'react-native';
import { fonts } from '../theme';
import { ownedAssetUrl } from '../conversationContract';
import { config } from '../config';
import { shareArtifactFile } from '../artifactFiles';
import { conversationSessionLease } from '../localStore';

// Mobile uses the existing hosted preview, never server-supplied inline HTML.
export default function WebsiteArtifact({ artifact, colors }) {
  const url = ownedAssetUrl(artifact?.url, config.API_BASE, 'website');
  if (!artifact) return null;
  async function exportHtml() {
    const current = conversationSessionLease();
    try { await shareArtifactFile('ozira-website.html', artifact.html, 'text/html', current); }
    catch (error) { if (current()) Alert.alert('Website export', error.message); }
  }
  return <View style={{ marginTop: 10, padding: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 10 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.semibold }}>{artifact.projectName || 'Website'}</Text>
    <Text style={{ color: colors.muted, marginVertical: 6 }}>{artifact.files?.length || 0} saved files</Text>
    {artifact.html ? <Pressable accessibilityRole="button" onPress={exportHtml}><Text style={{ color: colors.primary, paddingVertical: 8 }}>Save or share HTML file</Text></Pressable> : null}
    {url ? <><Pressable accessibilityRole="link" accessibilityLabel="Open website preview" onPress={() => Linking.openURL(url).catch(() => {})}>
      <Text style={{ color: colors.primary, textDecorationLine: 'underline', paddingVertical: 6 }}>Open website preview</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Share website link" onPress={() => Share.share({ message: url }).catch(() => {})}>
      <Text style={{ color: colors.primary, paddingVertical: 6 }}>Share website link</Text>
    </Pressable></> : <Text style={{ color: colors.muted }}>Private website. Export HTML to save or open it externally.</Text>}
  </View>;
}
