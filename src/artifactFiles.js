import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Called only by an explicit export button. This writes opaque bytes and opens
// the native chooser; it does not load HTML into a WebView or execute scripts.
export async function shareArtifactFile(name, data, mimeType, current) {
  if (!current()) return;
  if (!/^[A-Za-z0-9_-]+\.(html|docx|xlsx|pptx|pdf)$/.test(name)) throw new Error('Invalid export filename.');
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing unavailable.');
  if (!current()) return;
  let file;
  try {
    file = new File(Paths.cache, `${Date.now()}-${name}`);
    file.create(); file.write(data);
    if (!current()) return;
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Save or share file' });
  } finally { try { file?.delete(); } catch (_) {} }
}
