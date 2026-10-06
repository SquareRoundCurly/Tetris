import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const seed = new URL('../', import.meta.url)
async function sources() {
  return Object.fromEntries(await Promise.all(['game.json', 'inputs.json', 'scene/scene.json', 'scripts/main.js'].map(async (name) => [name, await readFile(new URL(name, seed), 'utf8')])))
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
async function press(page, code) { await page.keyboard.press(code); await page.evaluate(() => window.gameHost.step(1)) }
function canvas(page) { return page.frameLocator('iframe').getByLabel('Atlas game canvas') }

test('isolated WASM Tetris plays, clears a line and restores the complete game before ticks', async ({ page }, testInfo) => {
  const files = await sources()
  await mount(page, files)
  await expect(canvas(page)).toBeVisible()
  await canvas(page).focus()
  await press(page, 'Space')
  await expect.poll(async () => (await state(page)).lines).toBe(1)
  await press(page, 'ArrowLeft')
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
  for (let i = 0; i < 22; i++) await press(page, 'Space')
  await expect.poll(async () => (await state(page)).gameOver).toBe(true)
  await press(page, 'r')
  expect((await state(page)).locks).toBe(0)
  await page.keyboard.down('ArrowDown')
  expect(await page.evaluate(async () => (await window.gameHost.observe()).inputs.values['soft-drop'])).toBe(true)
  await page.evaluate(() => window.gameHost.pause())
  expect(await page.evaluate(async () => (await window.gameHost.observe()).keys)).toEqual([])
  await page.keyboard.up('ArrowDown')
  await page.evaluate(() => window.gameHost.step(1))
  await page.screenshot({ path: testInfo.outputPath('isolated-tetris.png') })
  expect(await page.evaluate(() => window.hostErrors)).toEqual([])
})

test('shared touch controls move, rotate, drop and hold through actual browser input', async ({ page }, testInfo) => {
  await mount(page, await sources())
  const controls=page.frameLocator('iframe')
  await controls.getByRole('button',{name:'Left',exact:true}).tap()
  await page.evaluate(()=>window.gameHost.step(1))
  expect((await state(page)).x).toBe(3)
  await controls.getByRole('button',{name:'Rotate',exact:true}).tap()
  await page.evaluate(()=>window.gameHost.step(1))
  expect((await state(page)).rotation).toBe(1)
  await controls.getByRole('button',{name:'Reset',exact:true}).tap()
  await page.evaluate(()=>window.gameHost.step(1))
  await controls.getByRole('button',{name:'Drop',exact:true}).tap()
  await page.evaluate(()=>window.gameHost.step(1))
  expect((await state(page)).lines).toBe(1)
  const right=await controls.getByRole('button',{name:'Right',exact:true}).boundingBox()
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:right.x+right.width/2,y:right.y+right.height/2}]})
  await page.evaluate(()=>window.gameHost.step(32))
  expect((await state(page)).x).toBeGreaterThan(5)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await page.evaluate(()=>window.gameHost.step(1))
  expect(await page.evaluate(async()=>(await window.gameHost.observe()).inputs.values.right)).toBe(false)
  await page.setViewportSize({width:348,height:760})
  await page.evaluate(()=>window.gameHost.step(1))
  for (const name of ['Left','Right','Rotate','Down','Drop','Reset']) {
    const box=await controls.getByRole('button',{name,exact:true}).boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(348)
  }
  await page.screenshot({path:testInfo.outputPath('shared-touch-controls.png')})
})

test('the new five-cell P piece rotates, stacks and resumes in the real browser', async ({ page }, testInfo) => {
  const files = await sources()
  await mount(page, files)
  await canvas(page).focus()
  await press(page, 'Space')
  await expect.poll(async () => (await state(page)).piece).toBe('P')
  await press(page, 'ArrowUp')
  for (let i = 0; i < 10; i++) await press(page, 'ArrowLeft')
  expect((await state(page)).x).toBe(1)
  expect((await state(page)).rotation).toBe(1)
  const saved = await page.evaluate(() => window.gameHost.snapshot())
  await page.evaluate(({ files, saved }) => window.mountTestGame(files, saved), { files, saved })
  expect(await page.evaluate(() => window.gameHost.snapshot())).toEqual(saved)
  await canvas(page).focus()
  await press(page, 'Space')
  const snapshot = await page.evaluate(() => window.gameHost.snapshot())
  expect(snapshot.scripts[0].state.board.flat().filter((cell) => cell === 'P')).toHaveLength(5)
  expect((await state(page)).piece).toBe('T')
  await page.evaluate(() => window.gameHost.step(1))
  await page.screenshot({ path: testInfo.outputPath('five-cell-piece.png') })
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
