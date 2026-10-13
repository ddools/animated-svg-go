import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Remove when M1 adds the first unit test.
    passWithNoTests: true,
  },
});
