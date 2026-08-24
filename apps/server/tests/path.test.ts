import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { safeRelPath } from '../src/utils/path';

// A stable absolute root for the tests. safeRelPath is pure path math, so the
// directory does not need to exist on disk.
const root = path.resolve(os.tmpdir(), 'nebula-test-root');

describe('safeRelPath (path traversal protection)', () => {
  it('resolves a valid relative path inside the root', () => {
    expect(safeRelPath('a/b/c.txt', root)).toBe(path.resolve(root, 'a/b/c.txt'));
    expect(safeRelPath('docs/notes.txt', root)).toBe(path.resolve(root, 'docs/notes.txt'));
  });

  it('returns null for an absolute path', () => {
    // A double-slash path is still absolute on both Windows and POSIX after
    // safeRelPath strips a single leading slash, so it is rejected everywhere.
    expect(safeRelPath('//etc/passwd', root)).toBeNull();
    // Windows drive-letter path (platform specific).
    if (process.platform === 'win32') {
      expect(safeRelPath('C:\\etc\\passwd', root)).toBeNull();
    }
  });

  it('returns null for path traversal using ../', () => {
    expect(safeRelPath('../etc/passwd', root)).toBeNull();
    expect(safeRelPath('../../../../windows/system32/cmd.exe', root)).toBeNull();
  });

  it('returns null for a path that escapes the root', () => {
    expect(safeRelPath('a/../../etc/passwd', root)).toBeNull();
    expect(safeRelPath('sub/../../../outside', root)).toBeNull();
    // A sibling of the root (same prefix, different directory) must be rejected.
    const sibling = safeRelPath('..', root);
    expect(sibling).toBeNull();
  });

  it('returns null for an empty string (no path supplied)', () => {
    // NOTE: safeRelPath treats empty input as "no path" and rejects it (null).
    // This differs from the route-local safeStoragePath, which maps '' to the
    // root. We assert the actual, safe behavior of the exported function.
    expect(safeRelPath('', root)).toBeNull();
  });

  it('normalizes double slashes and dots correctly', () => {
    expect(safeRelPath('a//b/./c.txt', root)).toBe(path.resolve(root, 'a/b/c.txt'));
    expect(safeRelPath('docs/./notes/..//final.txt', root)).toBe(path.resolve(root, 'docs/final.txt'));
  });

  it('decodes %2F (URL-encoded slash) before resolving', () => {
    expect(safeRelPath('a/%2Fc.txt', root)).toBe(path.resolve(root, 'a/c.txt'));
  });
});
