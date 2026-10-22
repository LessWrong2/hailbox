import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    // The widget touches window/localStorage, so Next.js must treat it as a client component.
    banner: { js: '"use client";' },
  },
  {
    // No React and no "use client": safe to import from server code.
    entry: { protocol: 'src/protocol.ts', client: 'src/client.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
  },
]);
