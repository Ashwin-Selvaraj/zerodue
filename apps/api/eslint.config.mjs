import base from '@zerodue/config/eslint';

export default [
  ...base,
  {
    // NestJS dependency injection reads constructor parameter and @Body() types at runtime via
    // emitDecoratorMetadata, so those imports must stay value imports. `import type` would break DI.
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
