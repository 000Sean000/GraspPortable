/** Grasp's deliberately small, side-effect-free string value language. */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export type TemplatePart = { kind: 'text'; text: string } | { kind: 'reference'; name: string; from: number; to: number };

export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const placeholder = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/y;
  let text = '';
  const flush = () => { if (text) { parts.push({ kind: 'text', text }); text = ''; } };
  for (let i = 0; i < template.length;) {
    if (template.startsWith('{{', i)) { text += '{'; i += 2; continue; }
    if (template.startsWith('}}', i)) { text += '}'; i += 2; continue; }
    if (template[i] === '{') {
      // Sticky matching fails at the next invalid character. Repeated malformed
      // braces must not repeatedly scan the rest of a large string (O(n²)).
      placeholder.lastIndex = i;
      const match = placeholder.exec(template);
      if (match) {
        flush(); parts.push({ kind: 'reference', name: match[1], from: i, to: placeholder.lastIndex }); i = placeholder.lastIndex; continue;
      }
    }
    text += template[i++];
  }
  flush();
  return parts;
}

export function templateDependencies(template: string): string[] {
  return [...new Set(parseTemplate(template).flatMap(part => part.kind === 'reference' ? [part.name] : []))];
}
