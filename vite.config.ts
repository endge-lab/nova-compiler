import path from 'path'
import { defineConfig } from 'vitest/config'
import dts from 'vite-plugin-dts'

const externalPackages = [
  '@endge/nova',
  '@endge/nova-ui-kit',
  'node:fs',
  'node:path',
  'node:crypto',
]

function isExternal(id: string): boolean {
  return externalPackages.some(pkg => id === pkg || id.startsWith(`${pkg}/`))
}

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      name: 'endge-nova-compiler',
    },
    rollupOptions: {
      external: isExternal,
    },
  },
  plugins: [dts({ rollupTypes: true, tsconfigPath: './tsconfig.app.json' })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
