import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Run in Node environment (engine/ has no browser deps per spec §14)
    environment: 'node',

    // Glob patterns for test files
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
    ],

    // Exclude e2e tests (those live in tests/e2e and use Playwright)
    exclude: ['tests/e2e/**', 'node_modules/**'],

    // Coverage via v8
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/engine/**', 'src/rules/**', 'src/extract/**', 'src/store/**'],
    },

    // Type-check tests
    typecheck: {
      enabled: false, // enable with `vitest --typecheck` explicitly
    },

    // Mock browser-only / worker-based modules that cannot run in Node.
    // pdfjs-dist and tesseract.js both need a browser environment and workers.
    // The extract tests only test PURE helper functions and inject synthetic
    // data; they never call extractPdfPages() or runOcrOnPages() directly.
    // We therefore mock the dynamic imports inside those functions so Node
    // doesn't try to instantiate a DOM worker.
    server: {
      deps: {
        // Force inline so Vitest can intercept them
        inline: ['pdfjs-dist', 'tesseract.js'],
      },
    },
  },
  resolve: {
    alias: {
      '@/rules': resolve(__dirname, 'src/rules'),
      '@/engine': resolve(__dirname, 'src/engine'),
      '@/extract': resolve(__dirname, 'src/extract'),
      '@/store': resolve(__dirname, 'src/store'),
      '@/ui': resolve(__dirname, 'src/ui'),
    },
  },
});
