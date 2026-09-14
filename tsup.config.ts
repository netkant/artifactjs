import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const USE_CLIENT = '"use client";\n';

function ensureUseClient(file: string) {
  const source = readFileSync(file, 'utf8');
  if (source.startsWith('"use client"') || source.startsWith("'use client'")) {
    return;
  }
  writeFileSync(file, USE_CLIENT + source);
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react'],
  async onSuccess() {
    ensureUseClient('dist/index.js');
    ensureUseClient('dist/index.cjs');
  },
});
