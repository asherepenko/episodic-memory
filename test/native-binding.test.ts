import { describe, it, expect } from 'vitest';
import { isNativeBindingError } from '../src/native-binding.js';

/**
 * isNativeBindingError gates the in-process rebuild: it must fire on the
 * real native-binding load failures (so a Node upgrade self-heals) and stay
 * quiet for ordinary SQL/filesystem errors (so we never rebuild needlessly or
 * mask a real bug). These messages are the actual strings seen in the wild —
 * see ~/.config/superpowers/logs/episodic-memory.log.
 */
describe('isNativeBindingError', () => {
  const bindingFailures = [
    'Could not locate the bindings file. Tried:\n → .../better_sqlite3.node',
    "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version requires NODE_MODULE_VERSION 147.",
    'Error [ERR_DLOPEN_FAILED]: dlopen(.../better_sqlite3.node, 0x0001): symbol not found',
    '/path/better_sqlite3.node: invalid ELF header',
    '\\\\?\\C:\\plugin\\better_sqlite3.node is not a valid Win32 application.',
  ];

  for (const msg of bindingFailures) {
    it(`detects: ${msg.split('\n')[0].slice(0, 48)}`, () => {
      expect(isNativeBindingError(new Error(msg))).toBe(true);
    });
  }

  const unrelated = [
    'SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed',
    'no such table: exchanges',
    "ENOENT: no such file or directory, open '/tmp/db.sqlite'",
    'database disk image is malformed',
  ];

  for (const msg of unrelated) {
    it(`ignores: ${msg.slice(0, 48)}`, () => {
      expect(isNativeBindingError(new Error(msg))).toBe(false);
    });
  }

  it('handles non-Error values without throwing', () => {
    expect(isNativeBindingError('Could not locate the bindings file')).toBe(true);
    expect(isNativeBindingError(undefined)).toBe(false);
    expect(isNativeBindingError(null)).toBe(false);
  });
});
