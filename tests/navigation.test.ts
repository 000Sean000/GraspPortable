import { describe, expect, it } from 'vitest';
import { NavigationHistory, NavigationIndex, type NavigationFolder, type NavigationNote } from '../src/app/navigation';

function note(id: string, title: string, folderId: string | null = null, markdown = ''): NavigationNote { return { id, title, folderId, markdown, revision: 1, updatedAt: '' }; }
const folders: NavigationFolder[] = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `層 ${i}`, parentId: i ? `f${i - 1}` : null, revision: 1 }));

describe('navigation data boundaries', () => {
  it('indexes 3000 notes, wide and deep folders, Unicode duplicate titles and source snippets', () => {
    const index = new NavigationIndex();
    const notes = Array.from({ length: 3000 }, (_, i) => note(`n${i}`, `Note ${i}`, i < 2275 ? 'f0' : 'f5', `# ${i}\n\nbody ${i}`));
    notes[42] = note('n42', '共同名稱', 'f0', '序文\n測試 C++ 與 [] (x) $1. 後文');
    notes[2999] = note('n2999', '共同名稱', 'f5', '不同內容');
    index.update(notes, folders);
    expect(index.noteList('f0')).toHaveLength(2275);
    expect(index.ancestors('f5')).toHaveLength(6);
    expect(index.search('共同名稱').map(hit => hit.path)).toEqual(['層 0 / 共同名稱', '層 0 / 層 1 / 層 2 / 層 3 / 層 4 / 層 5 / 共同名稱']);
    const hit = index.search('C++')[0];
    expect(hit.note.id).toBe('n42'); expect(hit.range).toEqual({ from: 6, to: 9 });
    expect(hit.snippet).toContain('測試 C++');
    expect(index.search('層 5 共同名稱', true).map(hit => hit.note.id)).toEqual(['n2999']);
    expect(index.search('不同內容', true)).toEqual([]);
    expect(index.search('[] (x) $1.')).toHaveLength(1);
    expect(index.folderScope('f0')).toEqual({ folders: 6, notes: 3000 });
  });
  it('updates renamed or moved paths, removed notes and edited content without stale hits', () => {
    const index = new NavigationIndex(); index.update([note('1', 'Original', 'f5', 'old content')], folders);
    index.update([note('1', 'Changed', 'f0', 'new content')], [{ ...folders[0], name: '新資料夾' }]);
    expect(index.search('Original')).toEqual([]); expect(index.search('old')).toEqual([]);
    expect(index.search('新資料夾 new')[0].path).toBe('新資料夾 / Changed');
    index.update([], folders); expect(index.search('new')).toEqual([]);
  });
  it('terminates malformed cycles and treats root notes independently of hierarchy', () => {
    const index = new NavigationIndex(); index.update([note('1', 'root')], [{ ...folders[0], parentId: 'f1' }, folders[1]]);
    expect(index.ancestors('f0')).toHaveLength(2); expect(index.descendants('f0').size).toBe(2); expect(index.notePath('1')).toBe('root');
  });
  it('keeps back/forward cursor across repeated note visits, prunes removed targets and branches', () => {
    const history = new NavigationHistory(); for (const id of ['a', 'b', 'a', 'c']) history.visit(id);
    history.move(-1); history.move(-1); history.move(-1); expect(history.current).toBe('a');
    history.prune(new Set(['a', 'b', 'c'])); expect(history.canBack).toBe(false); expect(history.destination(1)).toBe('b');
    history.move(1); history.visit('d'); expect(history.canForward).toBe(false); expect(history.destination(-1)).toBe('b');
    history.prune(new Set(['a', 'd'])); expect(history.destination(-1)).toBe('a');
    history.clear(); expect(history.canBack).toBe(false); expect(history.current).toBeUndefined();
  });
});
