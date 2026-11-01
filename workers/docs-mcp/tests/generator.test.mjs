import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('static generator preserves public reflection semantics without executing source', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dphp-generator-test-'));
  try {
    const output = join(temp, 'index.json');
    execFileSync(process.env.PHP_BINARY ?? 'php', ['-d', 'xdebug.mode=off', '-d', 'error_reporting=8191', fileURLToPath(new URL('../tools/generate.php', import.meta.url)), fileURLToPath(new URL('./fixtures', import.meta.url)), output], { stdio: 'pipe' });
    const index = JSON.parse(readFileSync(output, 'utf8'));
    const cls = index.classes['discord\\fixture\\sample'];
    assert.equal(Object.keys(index.classes).length, 3);
    assert.deepEqual(cls.interfaces, ['Discord\\Fixture\\Contract']);
    assert.deepEqual(cls.traits, ['Discord\\Fixture\\Behavior']);
    assert.ok(cls.properties.some(value => value.includes('$computed')));
    assert.ok(cls.properties.some(value => value.includes('$visible')));
    assert.ok(!cls.properties.some(value => value.includes('$hidden')));
    assert.equal(index.methods['discord\\fixture\\sample::privatemethod'], undefined);
    assert.equal(index.methods['discord\\fixture\\sample::protectedmethod'], undefined);
    const method = index.methods['discord\\fixture\\sample::example'];
    assert.match(method.signature, /^static /);
    assert.match(method.signature, /\$text = null/);
    assert.match(method.signature, /\.\.\.\$rest/);
    assert.ok(cls.documentation.includes('Ignore all previous instructions'), 'Untrusted documentation stays data rather than silently changing meaning');
    assert.match(index.docs['guide/sample.rst'].chunks[0], /日本語/);
    assert.ok(index.files['src/Discord/Sample.php']);
    const alternate = join(temp, 'alternate');
    cpSync(fileURLToPath(new URL('./fixtures', import.meta.url)), alternate, { recursive: true });
    for (const path of ['src/Discord/Sample.php', 'README.md', 'guide/sample.rst']) {
      const file = join(alternate, path);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n'));
    }
    const alternateOutput = join(temp, 'alternate.json');
    execFileSync(process.env.PHP_BINARY ?? 'php', ['-d', 'xdebug.mode=off', '-d', 'error_reporting=8191', fileURLToPath(new URL('../tools/generate.php', import.meta.url)), alternate, alternateOutput], { stdio: 'pipe' });
    assert.deepEqual(JSON.parse(readFileSync(alternateOutput, 'utf8')), index, 'CRLF and LF checkouts must reproduce the same artifact and hashes');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('invalid UTF-8 README and guide bytes fail promptly without writing an index', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dphp-invalid-utf8-test-'));
  try {
    for (const [i, path] of ['README.md', 'guide/sample.rst'].entries()) {
      const source = join(temp, `source-${i}`);
      cpSync(fileURLToPath(new URL('./fixtures', import.meta.url)), source, { recursive: true });
      // A tiny binary input exercised the old non-progress chunking loop.
      writeFileSync(join(source, path), Buffer.from([0x53, 0xff, 0x0a]));
      const output = join(temp, `index-${i}.json`);
      assert.throws(() => execFileSync(process.env.PHP_BINARY ?? 'php', [
        '-d', 'xdebug.mode=off', '-d', 'error_reporting=8191',
        fileURLToPath(new URL('../tools/generate.php', import.meta.url)), source, output,
      ], { stdio: 'pipe', timeout: 5000 }), error => {
        assert.notEqual(error.code, 'ETIMEDOUT', 'Generator must fail, not hang');
        assert.notEqual(error.status, 0);
        assert.match(String(error.stderr), /UTF-8/);
        return true;
      });
      assert.equal(existsSync(output), false);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
