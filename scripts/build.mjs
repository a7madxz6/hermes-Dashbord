import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

await build({
  entryPoints: ['src/plugin.jsx'], outfile: 'plugin.js', bundle: true, format: 'esm',
  jsx: 'automatic', target: 'es2022', external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  loader: { '.css': 'text' }, legalComments: 'none'
})
await mkdir('preview', { recursive: true })
await build({
  entryPoints: ['tests/preview.jsx'], outfile: 'preview/app.js', bundle: true, format: 'esm',
  jsx: 'automatic', target: 'es2022', loader: { '.css': 'text' },
  alias: { '@hermes/plugin-sdk': './tests/sdk.jsx' }
})
await writeFile('preview/index.html', `<!doctype html>
<html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>A7M Dashbord — preview</title><meta name="description" content="معاينة واختبار لوحة هيرمز للمهام">
<style>html,body{margin:0;overflow-x:clip}#root{height:100dvh}</style>
<div id="root"></div><script type="module" src="./app.js"></script></html>`)
console.log('Built desktop plugin.js and isolated preview (test SDK, not live Hermes).')
