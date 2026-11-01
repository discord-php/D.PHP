import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifySourceInputs } from './source-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] ?? '../../.source-discordphp');
const check = process.argv.includes('--check');
const lock = JSON.parse(readFileSync(join(root, 'source-lock.json'), 'utf8'));
verifySourceInputs(source, lock.revision);
const temp = mkdtempSync(join(tmpdir(), 'dphp-docs-index-'));
try {
  const output = join(temp, 'index.json');
  // phpDocumentor 4 matches the bot and PHP 8.1; its dynamic node properties
  // trigger PHP >=8.2 deprecations. Keep all non-deprecation diagnostics.
  execFileSync(process.env.PHP_BINARY ?? 'php', ['-d', 'xdebug.mode=off', '-d', 'error_reporting=8191', '-d', 'memory_limit=512M', join(root, 'tools/generate.php'), source, output], { stdio: 'inherit' });
  const generated = readFileSync(output);
  const target = join(root, 'generated/index.json');
  const license = readFileSync(join(source, 'LICENSE.md'), 'utf8').replace(/\r\n?/g, '\n');
  const licenseTarget = join(root, 'generated/DiscordPHP-LICENSE.md');
  const noticeTarget = join(root, 'generated/DiscordPHP-LICENSE.json');
  const notice = JSON.stringify(license) + '\n';
  if (check) {
    if (!generated.equals(readFileSync(target))) throw new Error('Generated index is stale');
    if (license !== readFileSync(licenseTarget, 'utf8')) throw new Error('Bundled source license is stale');
    if (notice !== readFileSync(noticeTarget, 'utf8')) throw new Error('Bundled runtime notice is stale');
  } else {
    mkdirSync(join(root, 'generated'), { recursive: true });
    copyFileSync(output, target);
    writeFileSync(licenseTarget, license);
    writeFileSync(noticeTarget, notice);
  }
  console.log(`${check ? 'Verified' : 'Generated'} pinned index (${generated.length} bytes)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
