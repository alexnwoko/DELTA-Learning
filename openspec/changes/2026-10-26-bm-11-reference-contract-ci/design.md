## Decisions

1. The test compares the schema and the TypeScript rules on the same rows,
   so a rule added to one side fails CI until the other side follows.
2. A count check ties the negative cases to the number of `allOf` rules.
3. `ajv` runs with `strict: false` because the schema uses `format` keywords
   for documentation; the rules check dates themselves.
