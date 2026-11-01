// The manifest as Chrome reads it (no errors, id, lang, colours, scope and start_url unchanged, no orientation, two maskable icons, no
// installability errors), and a screenshot of the icons under a circle, a squircle and a square mask with the 80% safe zone drawn.
//   node scripts/platform-harness/manifest.mjs
import { connect, sleep } from '../touch-harness/lib.mjs'
import { ORIGIN, OUT, check } from './lib.mjs'
import path from 'node:path'
const c = await connect()
await c.emulate(800, 420, 2, false)
await c.send('Page.navigate', { url: ORIGIN })
await sleep(4000)
const m = await c.send('Page.getAppManifest', {})
console.log('manifest url', m.url, 'errors', JSON.stringify(m.errors))
const data = JSON.parse(m.data)
check('manifest parses with no errors', (m.errors ?? []).length === 0)
console.log(JSON.stringify({ id: data.id, lang: data.lang, theme: data.theme_color, bg: data.background_color, display: data.display, scope: data.scope, start: data.start_url, orientation: data.orientation ?? '(none)', display_override: data.display_override ?? '(none)', icons: data.icons.length, categories: data.categories }))
check('id, lang and colours', data.id === '/' && data.lang === 'pt-BR' && data.theme_color === '#008000' && data.background_color === '#008000')
check('scope and start_url are unchanged (installed copies are not orphaned)', data.scope === './' && data.start_url === '/#/main')
check('no orientation lock in the manifest (decision D4)', data.orientation === undefined && data.display_override === undefined)
const maskable = data.icons.filter(i => i.purpose === 'maskable')
check('two maskable icons, 192 and 512', maskable.map(i => i.sizes).sort().join() === '192x192,512x512')
const parsed = await c.send('Page.getInstallabilityErrors', {}).catch(e => ({ installabilityErrors: [String(e)] }))
console.log('installability errors:', JSON.stringify(parsed.installabilityErrors))
const processed = await c.send('Page.getAppId', {}).catch(e => String(e))
console.log('app id as the browser resolves it:', JSON.stringify(processed))

// a preview of the two icons under the masks launchers use, with the 80% safe-zone circle drawn
await c.send('Page.navigate', { url: `${ORIGIN}manifest.webmanifest` })
await sleep(800)
await c.evBody(`
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#444;display:flex;gap:24px;padding:24px;font:14px sans-serif;color:#fff;flex-wrap:wrap';
  const cell = (src, shape, label) => '<div style="text-align:center"><div style="position:relative;width:192px;height:192px;background:#fff;overflow:hidden;border-radius:' + shape + '"><img src="' + src + '" style="width:192px;height:192px;display:block"></div><div>' + label + '</div></div>';
  const safe = '<div style="position:absolute;inset:0;border-radius:50%"></div>';
  const withSafe = (src, shape, label) => '<div style="text-align:center"><div style="position:relative;width:192px;height:192px;overflow:hidden;border-radius:' + shape + ';background:#fff"><img src="' + src + '" style="width:192px;height:192px;display:block"><div style="position:absolute;left:19.2px;top:19.2px;width:153.6px;height:153.6px;border:1px dashed #f0f;border-radius:50%"></div></div><div>' + label + '</div></div>';
  document.body.innerHTML =
    withSafe('/assets/pwaicons/android/android-maskable-512-512.png', '50%', 'maskable, circle') +
    withSafe('/assets/pwaicons/android/android-maskable-512-512.png', '22%', 'maskable, squircle') +
    withSafe('/assets/pwaicons/android/android-maskable-512-512.png', '0', 'maskable, square (dashed = safe zone)') +
    withSafe('/assets/pwaicons/android/android-launchericon-512-512.png', '50%', 'old "any" icon, circle');
  await Promise.all([...document.images].map(i => i.decode()));
`)
await sleep(500)
await c.shot(path.join(OUT, 'icons-masked.png'))
