// Client-side validation of existing backend message/artifact contracts.
// Keep only display data; a server response must never supply executable UI.
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function projectReference(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
}
export function ownedAssetUrl(value, baseUrl, kind = 'image') {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const base = new URL(baseUrl);
    const url = new URL(value, base.origin);
    const productionOrigins = ['https://ozira-ai-production.up.railway.app', 'https://www.ozira.et', 'https://ozira.et'];
    const sameEnvironment = url.origin === base.origin || (productionOrigins.includes(base.origin) && productionOrigins.includes(url.origin));
    if (!sameEnvironment || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const pattern = kind === 'website' ? /^\/site\/[a-f0-9]{32}$/ : /^\/img\/[A-Za-z0-9._-]{1,200}$/;
    return pattern.test(url.pathname) ? url.href : null;
  } catch (_) { return null; }
}
export function documentArtifact(value) {
  const mime = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf' };
  if (!object(value) || !/^doc_[A-Za-z0-9_-]{1,190}$/.test(value.id || '') || !Object.hasOwn(mime, value.format) || value.mimeType !== mime[value.format]) return null;
  if (typeof value.fileName !== 'string' || value.fileName.length > 100 || !/^[A-Za-z0-9_-]+\.(docx|xlsx|pptx|pdf)$/.test(value.fileName) || !value.fileName.endsWith('.' + value.format)) return null;
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > 1048576 || value.downloadUrl !== '/api/documents/' + value.id) return null;
  return { id: value.id, type: 'document', format: value.format, mimeType: value.mimeType, fileName: value.fileName, byteLength: value.byteLength, downloadUrl: value.downloadUrl, provenance: 'MODEL_INFERENCE', status: 'generated', projectId: projectReference(value.projectId) };
}
export function messageMetadata(value, baseUrl) {
  if (!object(value)) return undefined;
  const result = {};
  const document = documentArtifact(value.document);
  if (document) result.document = document;
  if (object(value.tool)) {
    const name = text(value.tool.name, 80), status = text(value.tool.status, 40);
    if (name && status) result.tool = { name, status };
  }
  const web = value.webBuild;
  if (object(web)) {
    const projectId = projectReference(web.projectId);
    const url = ownedAssetUrl(web.url, baseUrl, 'website');
    const html = typeof web.html === 'string' && web.html.length <= 1000000 ? web.html : '';
    if (projectId && (url || html)) result.webBuild = {
      projectId, projectName: text(web.projectName, 240), ...(url ? { url } : {}),
      // Opaque export data for the backend contract; never inserted into UI.
      ...(typeof web.html === 'string' && web.html.length <= 1000000 ? { html: web.html } : {}),
      files: Array.isArray(web.files) ? web.files.filter(file => typeof file === 'string' && file.length <= 200 && !file.split(/[\\/]/).includes('..') && !/^[\/\\]|[\x00-\x1f]/.test(file)).slice(0, 100) : [],
    };
  }
  if (Array.isArray(value.sources)) {
    result.sources = value.sources.filter(source => object(source) && typeof (source.href || source.url) === 'string').slice(0, 10).flatMap(source => {
      try {
        const href = new URL(source.href || source.url);
        return href.protocol === 'https:' && !href.username && !href.password ? [{ label: text(source.label || source.title, 160), href: href.href }] : [];
      } catch (_) { return []; }
    });
  }
  return Object.keys(result).length ? result : undefined;
}
export function conversationMessage(value, baseUrl) {
  if (!object(value) || !['user', 'assistant'].includes(value.role)) return null;
  const result = { role: value.role, content: text(value.content, 20000) };
  const image = ownedAssetUrl(value.image, baseUrl);
  if (image) result.image = image;
  if (typeof value.imageId === 'string') result.imageId = text(value.imageId, 200);
  if (typeof value.id === 'string') result.id = text(value.id, 200);
  if (typeof value.model === 'string') result.model = text(value.model, 60);
  if (value.reaction === 1 || value.reaction === -1) result.reaction = value.reaction;
  // Uploaded image input is retained for vision continuation, never executed.
  if (typeof value.thumb === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value.thumb) && value.thumb.length <= 12 * 1024 * 1024) result.thumb = value.thumb;
  const metadata = value.role === 'assistant' ? messageMetadata(value.metadata, baseUrl) : undefined;
  if (metadata) result.metadata = metadata;
  return result;
}
export function assistantMessage(response, baseUrl) {
  const first = Array.isArray(response?.images) ? response.images.find(image => object(image) && ownedAssetUrl(image.url, baseUrl)) : null;
  const document = Array.isArray(response?.documents) ? response.documents.map(documentArtifact).find(Boolean) : null;
  const metadata = { ...(object(response?.metadata) ? response.metadata : {}), ...(document ? { document } : {}) };
  return conversationMessage({ role: 'assistant', content: response?.reply || response?.notice || '', model: response?.modelLabel || response?.model,
    image: first?.url, imageId: first?.id, metadata }, baseUrl);
}
export function requestMessages(messages, baseUrl) {
  return (Array.isArray(messages) ? messages : []).map(message => conversationMessage(message, baseUrl)).filter(Boolean)
    .map(({ role, content, metadata }) => ({ role, content, ...(metadata ? { metadata } : {}) }));
}
