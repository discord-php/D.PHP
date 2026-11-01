import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import index from '../generated/index.json' with { type: 'json' };
import lock from '../source-lock.json' with { type: 'json' };
import upstreamLicense from '../generated/DiscordPHP-LICENSE.json' with { type: 'json' };

assert.equal(index.schemaVersion, 1);
assert.equal(upstreamLicense, readFileSync(new URL('../generated/DiscordPHP-LICENSE.md', import.meta.url), 'utf8'));
for (const [key, value] of Object.entries(lock)) assert.equal(index.provenance[key], value);
assert.match(lock.revision, /^[a-f0-9]{40}$/);
assert.equal(index.provenance.inputSha256, createHash('sha256').update(JSON.stringify(index.files)).digest('hex'));
const safeSource = path => /^(?:src\/Discord\/[A-Za-z0-9_\/-]+\.php|README\.md|guide\/[A-Za-z0-9_\/-]+\.rst)$/.test(path);
for (const [path, hash] of Object.entries(index.files)) {
  assert.ok(safeSource(path), path);
  assert.match(hash, /^[a-f0-9]{64}$/);
}
assert.ok(Object.keys(index.classes).length > 400, 'Expected full public API index');
assert.ok(Object.keys(index.methods).length > 1000, 'Expected public method coverage');
for (const [key, cls] of Object.entries(index.classes)) {
  assert.equal(key, cls.name.toLowerCase());
  assert.ok(index.files[cls.source]);
  assert.ok(Number.isInteger(cls.line) && cls.line > 0);
  assert.ok(cls.summary.length <= 1200);
  for (const name of cls.methods) {
    assert.equal(index.methods[name.toLowerCase()]?.class, cls.name);
  }
}
for (const [key, method] of Object.entries(index.methods)) {
  assert.equal(key, method.name.toLowerCase());
  assert.ok(index.classes[method.class.toLowerCase()]?.methods.includes(method.name));
  assert.ok(index.files[method.source]);
  assert.ok(method.documentation.length <= 8000);
  assert.ok(method.signature.length <= 4000);
}
for (const [path, doc] of Object.entries(index.docs)) {
  assert.equal(path, doc.path);
  assert.ok(index.files[path]);
  assert.ok(doc.chunks.length > 0);
  for (const chunk of doc.chunks) assert.ok(Buffer.byteLength(chunk) <= 4000);
}
const source = ['reference', 'server', 'worker', 'prepared-schema'].map(name => readFileSync(new URL(`../src/${name}.mjs`, import.meta.url), 'utf8')).join('\n');
assert.doesNotMatch(source, /(?:from\s+['"]node:|\bawait\s+fetch\s*\(|globalThis\.fetch|\bDISCORD_TOKEN\b|\beval\s*\()/, 'Runtime must not use network/filesystem/eval/secrets');
console.log(`Index consistent: ${Object.keys(index.classes).length} types, ${Object.keys(index.methods).length} public methods, ${Object.keys(index.docs).length} documents, ${Object.keys(index.files).length} hashed inputs`);
