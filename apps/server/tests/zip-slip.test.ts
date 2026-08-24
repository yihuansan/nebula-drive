import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { safeRelPath } from '../src/utils/path';

// The POST /files/decompress route validates EVERY zip entry before writing
// (files.routes.ts, the "P0-4 修复" block): entries for which the safe-path
// check returns null are skipped, so a malicious archive can never write
// outside the storage root. safeRelPath is the exported form of that check, so
// we exercise the zip-slip protection through it.
const root = path.resolve(os.tmpdir(), 'nebula-zip-root');

describe('zip-slip protection (zip entry validation)', () => {
  it('allows a normal zip entry name', () => {
    expect(safeRelPath('docs/readme.txt', root)).toBe(path.resolve(root, 'docs/readme.txt'));
    expect(safeRelPath('images/logo.png', root)).toBe(path.resolve(root, 'images/logo.png'));
  });

  it('rejects a zip entry that traverses with ../', () => {
    expect(safeRelPath('../../etc/passwd', root)).toBeNull();
    expect(safeRelPath('a/../../../etc/shadow', root)).toBeNull();
  });

  it('rejects a zip entry with an absolute path', () => {
    expect(safeRelPath('//etc/passwd', root)).toBeNull();
    if (process.platform === 'win32') {
      expect(safeRelPath('C:\\Windows\\system32\\evil.dll', root)).toBeNull();
    }
  });

  it('does not let an encoded traversal (%2e%2e%2f) escape the root', () => {
    // safeRelPath only decodes %2F (not %2e), so "%2e%2e%2f" becomes a literal
    // in-root name rather than "../". The security guarantee we assert is the
    // important one: the result must NEVER point outside the root.
    const result = safeRelPath('%2e%2e%2f', root);
    if (result !== null) {
      expect(result === root || result.startsWith(root + path.sep)).toBe(true);
    }
    // A fully-encoded traversal must also be contained within the root.
    const full = safeRelPath('%2e%2e%2f%2e%2e%2fetc%2fpasswd', root);
    if (full !== null) {
      expect(full === root || full.startsWith(root + path.sep)).toBe(true);
    }
  });
});
