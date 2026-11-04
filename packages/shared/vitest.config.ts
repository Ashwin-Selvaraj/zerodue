import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The finance engine is money logic: every branch must be exercised.
      include: ['src/finance/**/*.ts'],
      exclude: ['src/finance/**/*.test.ts', 'src/finance/golden/**', 'src/finance/index.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
