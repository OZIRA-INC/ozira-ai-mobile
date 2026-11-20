// Lightweight markdown renderer for AI replies. Models answer in markdown, and
// dumping raw ** and ## into a <Text> makes results look like broken chat.
// Handles: headings, bullets, numbered lists, fenced code, inline code,
// **bold**, and [label](url) links. No dependencies.
import React from 'react';
import { View, Text, Linking, Platform } from 'react-native';
import { fonts } from '../theme';
import { numberedLines } from '../markdownLines';

// 'monospace' is Android-only; iOS needs a real font name.
const MONO = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) };

// Split one line into styled inline segments: **bold**, `code`, [t](url).
function inlineParts(line, colors, baseStyle) {
  const out = [];
  const rx = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0, m, k = 0;
  while ((m = rx.exec(line))) {
    if (m.index > last) out.push(<Text key={'p' + k++}>{line.slice(last, m.index)}</Text>);
    const seg = m[0];
    if (seg.startsWith('**')) {
      out.push(<Text key={'b' + k++} style={{ fontFamily: fonts.bold }}>{seg.slice(2, -2)}</Text>);
    } else if (seg.startsWith('`')) {
      out.push(<Text key={'c' + k++} style={[MONO, { backgroundColor: colors.cardAlt, fontSize: 13 }]}>{seg.slice(1, -1)}</Text>);
    } else {
      const t = seg.slice(1, seg.indexOf(']'));
      const url = seg.slice(seg.indexOf('(') + 1, -1);
      out.push(
        <Text key={'l' + k++} style={{ color: colors.primary, textDecorationLine: 'underline' }}
          onPress={() => Linking.openURL(url).catch(() => {})}>{t}</Text>
      );
    }
    last = m.index + seg.length;
  }
  if (last < line.length) out.push(<Text key={'p' + k++}>{line.slice(last)}</Text>);
  return out.length ? out : [<Text key="e">{line}</Text>];
}

export default function Markdown({ text, colors, style }) {
  const src = numberedLines(typeof text === 'string' ? text : '');
  // pull fenced code blocks out first so their content is never styled
  const chunks = src.split(/```\w*\n?/);
  const nodes = [];
  chunks.forEach((chunk, ci) => {
    if (ci % 2 === 1) {
      // odd chunks are inside a fence
      nodes.push(
        <View key={'code' + ci} style={{ backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginVertical: 5 }}>
          <Text style={[MONO, { color: colors.text, fontSize: 12.5, lineHeight: 18 }]}>{chunk.replace(/\n+$/, '')}</Text>
        </View>
      );
      return;
    }
    const lines = chunk.replace(/\n{3,}/g, '\n\n').split('\n');
    lines.forEach((line, li) => {
      const key = 'ln' + ci + '-' + li;
      const h = line.match(/^#{1,4}\s+(.+)$/);
      if (h) {
        nodes.push(<Text key={key} style={[style, { fontFamily: fonts.bold, fontSize: 15.5, marginTop: li ? 6 : 0 }]}>{inlineParts(h[1], colors, style)}</Text>);
        return;
      }
      const b = line.match(/^[ \t]*[-*]\s+(.+)$/);
      if (b) {
        nodes.push(<Text key={key} style={style}>{'• '}{inlineParts(b[1], colors, style)}</Text>);
        return;
      }
      if (line === '' ) {
        nodes.push(<View key={key} style={{ height: 6 }} />);
        return;
      }
      nodes.push(<Text key={key} style={style}>{inlineParts(line, colors, style)}</Text>);
    });
  });
  return <View>{nodes}</View>;
}
