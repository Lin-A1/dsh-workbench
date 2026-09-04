import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

const PKG_ID = 'dsh-workbench'

function xtermCssInline(): {
  name: string
  resolveId(source: string): string | null
  load(id: string): string | null
} {
  const VIRTUAL = '\0dsh-workbench:xterm-css'
  return {
    name: 'dsh-workbench:xterm-css',
    resolveId(source: string) {
      return source === '@xterm/xterm/css/xterm.css' ? VIRTUAL : null
    },
    load(id: string) {
      if (id !== VIRTUAL) return null
      const real = createRequire(import.meta.url).resolve('@xterm/xterm/css/xterm.css')
      const css = readFileSync(real, 'utf8')
      return `module.exports = ${JSON.stringify(css)};`
    },
  }
}

const nodeConfig: UserConfig = {
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  outDir: 'lib',
  sourcemap: false,
  fixedExtension: false,
  clean: true,
}

const clientConfig: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    alwaysBundle: (specifier: string) =>
      specifier !== 'react' &&
      specifier !== 'react/jsx-runtime' &&
      specifier !== 'react-dom' &&
      specifier !== 'react-dom/client',
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
  plugins: [xtermCssInline()],
}

export default [nodeConfig, clientConfig]
