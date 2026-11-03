import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Base flat config shared by every ZeroDue TypeScript package. */
export default tseslint.config(
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
