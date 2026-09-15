import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const seed = new URL('../', import.meta.url)
async function sources() {
  return Object.fromEntries(await Promise.all(['game.json', 'scene/scene.json', 'scripts/main.js'].map(async (name) => [name, await readFile(new URL(name, seed), 'utf8')])))
}
async function mount(page, files, save = null) {
  await page.goto('/tests/host.html')
  await page.waitForFunction(() => typeof window.mountTestGame === 'function')
  await page.evaluate(({ files, save }) => window.mountTestGame(files, save), { files, save })
}
async function state(page) {
  return page.evaluate(async () => {
    const result = await window.gameHost.observe({ entities: [20] })
    return JSON.parse(result.scene.entities[0].name.slice('Tetris state '.length))
  })
}
function canvas(page) { return page.frameLocator('iframe').getByLabel('Atlas game canvas') }

test('isolated WASM Tetris plays, clears a line and restores the complete game before ticks', async ({ page }, testInfo) => {
  const files = await sources()
  await mount(page, files)
  await expect(canvas(page)).toBeVisible()
  await canvas(page).focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await state(page)).lines).toBe(1)
  await page.keyboard.press('ArrowLeft')
  await page.evaluate(() => window.gameHost.step(17))
  const before = await state(page)
  const save = await page.evaluate(() => window.gameHost.snapshot())
  expect(save.scripts[0].state.elapsedSeconds).toBeGreaterThan(0)
  await page.evaluate(({ files, save }) => window.mountTestGame(files, save), { files, save })
  expect(await state(page)).toEqual(before)
  expect(await page.evaluate(() => window.gameHost.snapshot())).toEqual(save)
  await page.evaluate(() => window.gameHost.step(24))
  expect((await state(page)).y).toBe(before.y - 1)
  await canvas(page).focus()
  for (let i = 0; i < 22; i++) await page.keyboard.press('Space')
  await expect.poll(async () => (await state(page)).gameOver).toBe(true)
  await page.keyboard.press('r')
  expect((await state(page)).locks).toBe(0)
  await page.keyboard.down('ArrowDown')
  expect(await page.evaluate(async () => (await window.gameHost.observe()).keys)).toContain('ArrowDown')
  await page.evaluate(() => window.gameHost.pause())
  expect(await page.evaluate(async () => (await window.gameHost.observe()).keys)).toEqual([])
  await page.keyboard.up('ArrowDown')
  await page.evaluate(() => window.gameHost.step(1))
  await page.screenshot({ path: testInfo.outputPath('isolated-tetris.png') })
  expect(await page.evaluate(() => window.hostErrors)).toEqual([])
})

test('touch controls hit the visible game entities', async ({ page }) => {
  await mount(page, await sources())
  const bounds = await canvas(page).boundingBox()
  // The declared orthographic camera is 14 by 23; this viewport has that ratio.
  await page.touchscreen.tap(bounds.x + bounds.width * (1 / 14 + 0.5), bounds.y + bounds.height * (0.5 + 10.35 / 23))
  await expect.poll(async () => (await state(page)).lines).toBe(1)
})

test('published script cannot read parent state, use local storage or fetch the app API', async ({ page }) => {
  const requests = []
  page.on('request', (request) => { if (request.url().includes('/api/forbidden')) requests.push(request.url()) })
  const files = await sources()
  files['scripts/main.js'] = files['scripts/main.js'].replace('reset(game)\n  },\n\n  reset', `reset(game)
    const denied = (fn) => { try { fn(); return false } catch { return true } }
    const result = { parent: denied(() => parent.document.body), storage: denied(() => localStorage.getItem('secret')) }
    game.report(result)
    fetch('http://127.0.0.1:4182/api/forbidden').then(() => game.report({ ...result, networkBlocked: false }), () => game.report({ ...result, networkBlocked: true }))
  },

  reset`)
  await mount(page, files)
  await expect.poll(() => page.evaluate(async () => (await window.gameHost.observe()).game['1'])).toEqual({ parent: true, storage: true, networkBlocked: true })
  expect(requests).toEqual([])
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
  await page.evaluate(() => window.postMessage({ type: 'pocketrealms.boot', channel: 'foreign' }, '*'))
  expect((await state(page)).piece).toBe('I')
})

test('missing package file and corrupt save fail explicitly', async ({ page }) => {
  const files = await sources()
  delete files['scripts/main.js']
  await expect(mount(page, files)).rejects.toThrow(/Missing published file/)
  expect(await page.evaluate(() => window.hostErrors.join(' '))).toContain('Missing published file')
  await expect(mount(page, await sources(), { format: 500 })).rejects.toThrow(/Invalid Atlas save/)
})
