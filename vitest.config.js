import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/parseOse.js', 'src/oseStatus.js', 'src/exportOse.js'],
    },
    testTimeout: 10000,
  },
});
