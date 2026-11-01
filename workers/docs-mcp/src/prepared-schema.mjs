// Immutable schema metadata is shared; SDK servers/transports are never shared.
function freezeJson(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareInputSchema(schema, example) {
  // Prime Zod's lazy recursion/parser analysis within the startup budget.
  schema.parse(example);
  const standard = schema['~standard'];
  const input = freezeJson(standard.jsonSchema.input({ target: 'draft-2020-12' }));
  return Object.freeze({
    '~standard': Object.freeze({
      version: 1,
      vendor: 'dphp-prepared-zod',
      validate: value => standard.validate(value),
      jsonSchema: Object.freeze({
        input: ({ target } = {}) => {
          if (target && target !== 'draft-2020-12') throw new Error('Unsupported tool JSON Schema target');
          return input;
        },
        output: options => standard.jsonSchema.output(options),
      }),
    }),
  });
}
