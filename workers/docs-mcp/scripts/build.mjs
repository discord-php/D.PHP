import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './check-index.mjs';

execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'deploy', '--dry-run', '--outdir', 'dist'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: fileURLToPath(new URL('../.wrangler/local-config/', import.meta.url)) },
});
