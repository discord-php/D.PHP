import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { prepareInputSchema } from '../src/prepared-schema.mjs';
import { createServer } from '../src/server.mjs';

test('prepared schemas preserve strict Zod validation/defaults and share immutable JSON only', async () => {
  const schema = z.strictObject({ query: z.string().min(2).refine(value => !value.includes('!')), limit: z.number().int().min(1).max(20).default(10) });
  const prepared = prepareInputSchema(schema, { query: 'ok' });
  const standard = prepared['~standard'];
  const json = standard.jsonSchema.input({ target: 'draft-2020-12' });
  assert.deepEqual(json, schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
  assert.equal(standard.jsonSchema.input(), json);
  assert.ok(Object.isFrozen(json.properties.query));
  assert.throws(() => { json.properties.query.minLength = 0; }, TypeError);
  for (const input of [{ query: 'ok' }, { query: 'ok', limit: 20 }, { query: 'x' }, { query: '!bad' }, { query: 'ok', limit: 21 }, { query: 'ok', extra: true }]) {
    assert.deepEqual(await standard.validate(input), await schema['~standard'].validate(input));
  }
  assert.deepEqual((await standard.validate({ query: 'ok' })).value, { query: 'ok', limit: 10 });
  const first = createServer();
  const second = createServer();
  assert.notEqual(first, second);
  assert.notEqual(first.server, second.server);
  await first.close();
  await second.close();
});
