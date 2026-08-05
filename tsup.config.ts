import { defineConfig } from 'tsup';

// Clean once before parallel entry builds — `clean: true` on any config races
// when tsup runs the array in parallel and can delete another entry's output
// (e.g. dist/cli.js), which makes npm strip the bin during publish.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    target: 'es2022',
  },
  {
    entry: { react: 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    target: 'es2022',
    external: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'ai',
      '@ai-sdk/react',
    ],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    target: 'es2022',
  },
]);
