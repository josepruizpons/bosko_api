/**
 * Playwright capture: subida manual de un stem en BeatStars Studio.
 *
 * Uso:
 *   node scripts/capture-stems-upload.mjs
 *
 * Lo que hace:
 *   1. Abre Chromium (headed) en https://studio.beatstars.com
 *   2. Tú inicias sesión a mano con la cuenta que tenga stems disponibles
 *   3. Navegas a un track y subes un stem
 *   4. Cuando termines, CIERRA la ventana del navegador y se vuelca todo a disco
 *
 * Captura:
 *   - URL, método, headers, body de la request
 *   - Status y body de la response
 *   - Filtra a dominios beatstars / uppy
 *
 * Output:
 *   /tmp/bs-stems-capture.json    (todo)
 *   /tmp/bs-stems-capture-stems.json  (sólo requests que mencionan 'stem')
 *   /tmp/bs-stems-capture-graphql.json (sólo GraphQL por operationName)
 */
import { createRequire } from 'module'
import fs from 'fs'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/josep/.nvm/versions/node/v20.19.3/lib/node_modules/playwright')

const TARGET_HOSTS = ['beatstars.net', 'beatstars.com', 'uppy-v4.beatstars']

function host_matches(url) {
  return TARGET_HOSTS.some(h => url.includes(h))
}

function safe_parse(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  })

  const captured = []
  // key = request id → entry being built
  const pending = new Map()

  context.on('request', request => {
    const url = request.url()
    if (!host_matches(url)) return
    const entry = {
      url,
      method: request.method(),
      resource_type: request.resourceType(),
      headers: request.headers(),
      post_data: safe_parse(request.postData()),
      response: null,
      response_headers: null,
      status: null,
      timing_ms: Date.now(),
    }
    captured.push(entry)
    pending.set(request, entry)
  })

  context.on('response', async response => {
    const request = response.request()
    const entry = pending.get(request)
    if (!entry) return
    entry.status = response.status()
    entry.response_headers = response.headers()
    try {
      const text = await response.text()
      entry.response = safe_parse(text)
    } catch (err) {
      entry.response = `<error reading body: ${err.message}>`
    }
    entry.timing_ms = Date.now() - entry.timing_ms
    pending.delete(request)
  })

  const page = await context.newPage()
  await page.goto('https://studio.beatstars.com', { waitUntil: 'domcontentloaded' })

  console.log('\n────────────────────────────────────────────')
  console.log(' 1. Inicia sesión con tu cuenta que tenga stems')
  console.log(' 2. Abre un track y sube un stem')
  console.log(' 3. Cuando termines, CIERRA la ventana del navegador')
  console.log('────────────────────────────────────────────\n')

  // Esperar a que se cierre el contexto (al cerrar la ventana)
  await new Promise(resolve => {
    context.on('close', resolve)
    browser.on('disconnected', resolve)
  })

  console.log(`\nCapturadas ${captured.length} requests. Volcando…`)

  fs.writeFileSync('/tmp/bs-stems-capture.json', JSON.stringify(captured, null, 2))

  const stem_related = captured.filter(c => {
    const blob = JSON.stringify(c).toLowerCase()
    return blob.includes('stem') || blob.includes('binary')
  })
  fs.writeFileSync('/tmp/bs-stems-capture-stems.json', JSON.stringify(stem_related, null, 2))

  // GraphQL agrupado por operationName
  const graphql = captured
    .filter(c => c.url.includes('/graphql'))
    .map(c => ({
      operationName: c.post_data?.operationName ?? '(unknown)',
      url: c.url,
      status: c.status,
      variables: c.post_data?.variables,
      // Capturamos query truncada para identificar
      query_preview: typeof c.post_data?.query === 'string'
        ? c.post_data.query.slice(0, 240)
        : null,
      response: c.response,
    }))
  fs.writeFileSync('/tmp/bs-stems-capture-graphql.json', JSON.stringify(graphql, null, 2))

  console.log('  /tmp/bs-stems-capture.json')
  console.log('  /tmp/bs-stems-capture-stems.json     (' + stem_related.length + ' entradas)')
  console.log('  /tmp/bs-stems-capture-graphql.json   (' + graphql.length + ' GraphQL ops)')

  // Resumen rápido en consola
  const ops = [...new Set(graphql.map(g => g.operationName))]
  console.log('\nGraphQL operations vistas:')
  for (const op of ops) console.log('  •', op)

  try { await browser.close() } catch { /* ya cerrado */ }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
