import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifySourceInputs } from '../scripts/source-inputs.mjs';

test('source pin includes dirty licenses and rejects top-level README/LICENSE symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'dphp-source-pin-test-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init');
    writeFileSync(join(root, 'README.md'), 'Public reference\n');
    writeFileSync(join(root, 'LICENSE.md'), 'Original notice\n');
    git('add', 'README.md', 'LICENSE.md');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture source');
    const revision = git('rev-parse', 'HEAD');
    verifySourceInputs(root, revision);
    assert.throws(() => verifySourceInputs(root, '0'.repeat(40)), /does not match/);
    writeFileSync(join(root, 'LICENSE.md'), 'Changed notice\n');
    assert.throws(() => verifySourceInputs(root, revision), /must be clean/);
    git('checkout', '--', 'LICENSE.md');
    verifySourceInputs(root, revision);
    // Exercise real file symlinks, including broken targets. Unsupported hosts
    // report a failure rather than claiming symlink coverage.
    for (const path of ['README.md', 'LICENSE.md']) {
      git('checkout', '--', path);
      rmSync(join(root, path));
      try {
        symlinkSync('target.txt', join(root, path), 'file');
      } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          git('checkout', '--', path);
          throw new Error(`File symlink regression unavailable on this host: ${error.code}`);
        }
        throw error;
      }
      assert.throws(() => verifySourceInputs(root, revision), /Symlink input is not allowed/);
      rmSync(join(root, path));
      git('checkout', '--', path);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
