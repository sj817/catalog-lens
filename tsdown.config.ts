import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  deps: {
    neverBundle: ['vscode'],
  },
  sourcemap: !process.argv.includes('--minify'),
  clean: true,
})
