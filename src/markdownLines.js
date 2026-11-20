// Normalize ordered-list labels without modifying code or the stored response.
// Blank lines and indented continuation paragraphs remain in the same list.
export function numberedLines(source) {
  let fence = false, counter = null;
  const parents = [];
  return String(source || '').split(/\r?\n/).map(line => {
    if (/^\s*```/.test(line)) { fence = !fence; counter = null; parents.length = 0; return line; }
    if (fence) return line;
    const item = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (item) {
      const indent = item[1].replace(/\t/g, '    ').length;
      while (parents.length && parents[parents.length - 1].indent > indent) parents.pop();
      let level = parents[parents.length - 1];
      if (!level || level.indent !== indent) { level = { indent, number: Number(item[2]) }; parents.push(level); }
      else level.number += 1;
      counter = level.number;
      return `${item[1]}${counter}. ${item[3]}`;
    }
    if (line.trim() && !/^\s+\S/.test(line)) { counter = null; parents.length = 0; }
    return line;
  }).join('\n');
}
