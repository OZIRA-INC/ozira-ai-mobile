import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { shareArtifactFile } from '../artifactFiles';
import { useAuth } from '../context/AuthContext';
import { conversationSessionLease } from '../localStore';
import { downloadDocument } from '../api';
export default function DocumentArtifact({ artifact, colors }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  async function share() {
    if (busy) return;
    const current = conversationSessionLease();
    setBusy(true);
    try {
      const result = await downloadDocument(artifact, token);
      if (!current()) return;
      await shareArtifactFile(result.artifact.fileName, result.bytes, artifact.mimeType, current);
    } catch (error) { if (current()) Alert.alert('Document', error.message); }
    finally { if (current()) setBusy(false); }
  }
  return <View style={{ marginTop: 10 }}><Text style={{ color: colors.text }}>{artifact.fileName}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={share}><Text style={{ color: colors.primary, paddingVertical: 8 }}>{busy ? 'Preparing document…' : 'Save or share document'}</Text></Pressable></View>;
}
