import type { ParsedNoteLanguage } from '../domain/note-language';

/**
 * Only a closed, independent plain final paragraph may bypass a full semantic
 * scan. Appending letters cannot open/close Markdown or Grasp syntax. Every
 * uncertain context, mutation before EOF, separator or punctuation falls back.
 * The server still parses and validates every committed source normally.
 */
export function reusePlainProseAppend(previous: ParsedNoteLanguage, source: string, revision: number): ParsedNoteLanguage | undefined {
  const before = previous.source;
  if (!previous.contextsComplete || previous.diagnostics.length || source.length <= before.length || !source.startsWith(before)) return;
  const insertion = source.slice(before.length);
  if (!/^[\p{L}\p{M}\p{N} ]+$/u.test(insertion)) return;
  const from = Math.max(before.lastIndexOf('\r'), before.lastIndexOf('\n')) + 1;
  const paragraph = before.slice(from);
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} :]*$/u.test(paragraph)) return;
  if (from) {
    const separatorFrom = before[from - 1] === '\n' && before[from - 2] === '\r' ? from - 2 : from - 1;
    if (separatorFrom && before[separatorFrom - 1] !== '\n' && before[separatorFrom - 1] !== '\r') return;
  }
  if (previous.bindings.some(span => span.to > from) || previous.references.some(span => span.to > from)
    || previous.excluded.some(span => span.to >= from)) return;
  return { ...previous, source, revision, contextPasses: 0, hostCharactersRead: 0 };
}
