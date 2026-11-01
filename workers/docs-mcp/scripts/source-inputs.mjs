import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

// Build-time only. Every copied/parsed top-level file participates in the pin.
export function verifySourceInputs(source, revision) {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, '-C', source, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== revision) throw new Error('Source checkout does not match source-lock.json');
  for (const path of ['README.md', 'LICENSE.md']) {
    if (lstatSync(join(source, path)).isSymbolicLink()) throw new Error(`Symlink input is not allowed: ${path}`);
  }
  if (git('status', '--porcelain', '--untracked-files=all', '--', 'src', 'guide', 'README.md', 'LICENSE.md')) throw new Error('Index inputs must be clean, including untracked files');
}
