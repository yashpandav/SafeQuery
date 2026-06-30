import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist',
    noExternal: [/^@repo\//],
    sourcemap: true,
    clean: true,
  },
  {
    entry: { 'execute-write-worker': 'src/execute-write-worker.ts' },
    format: ['esm'],
    outDir: 'dist',
    noExternal: [/^@repo\//],
    sourcemap: true,
  },
])
