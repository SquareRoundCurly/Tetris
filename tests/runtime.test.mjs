import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const config = JSON.parse(await readFile(new URL('../pocketrealms.json', import.meta.url)))
const { loadProject, ScriptRuntime } = await import(new URL(`../.runtime/${config.runtime.build}/test-runtime.js`, import.meta.url))


const moduleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)


class FakeAtlas {
  constructor(entities) {
    this.entities = new Map(
      entities.map((entity) => [entity.id, structuredClone(entity)]),
    )
  }

  getEntity(id) {
    const entity = this.entities.get(id)
    return entity ? structuredClone(entity) : null
  }

  setEntity(entity) {
    this.entities.set(entity.id, structuredClone(entity))
  }

  removeEntity(id) {
    return this.entities.delete(id)
  }
}


async function loadTetris() {
  const project = await loadProject((relativePath) =>
    readFile(path.join(moduleRoot, relativePath), 'utf8'),
  )
  const script = project.scripts[0]
  const moduleUrl = pathToFileURL(path.join(moduleRoot, script.source))
  moduleUrl.searchParams.set('instance', crypto.randomUUID())
  const behavior = (await import(moduleUrl)).default
  const atlas = new FakeAtlas(project.scene.entities)
  const runtime = new ScriptRuntime(atlas, [{ ...script, behavior }], () => {})
  runtime.start()
  return { atlas, project, runtime }
}


function state(atlas) {
  const name = atlas.getEntity(20)?.name ?? ''
  assert.match(name, /^Tetris state /)
  return JSON.parse(name.slice('Tetris state '.length))
}


test('seed starts a deterministic 10 by 20 unlit game', async () => {
  const { atlas, project } = await loadTetris()

  assert.equal(
    project.scene.systems[0]['Atlas::Systems::GraphicsSystem'].pipeline,
    'atlas:unlit',
  )
  assert.equal(
    [...atlas.entities.values()].filter(({ id }) => id >= 100 && id < 300).length,
    200,
  )
  assert.deepEqual(state(atlas), {
    piece: 'I',
    x: 4,
    y: 18,
    rotation: 0,
    lines: 0,
    locks: 0,
    sequenceIndex: 1,
    gameOver: false,
  })
})


test('keyboard movement, rotation, gravity, and reset share deterministic state', async () => {
  const { atlas, runtime } = await loadTetris()

  runtime.input({ type: 'keydown', key: 'ArrowLeft', code: 'ArrowLeft' })
  assert.equal(state(atlas).x, 3)
  runtime.input({ type: 'keyup', key: 'ArrowLeft', code: 'ArrowLeft' })

  runtime.input({ type: 'keydown', key: 'ArrowUp', code: 'ArrowUp' })
  assert.equal(state(atlas).rotation, 1)
  runtime.input({ type: 'keyup', key: 'ArrowUp', code: 'ArrowUp' })

  runtime.input({ type: 'keydown', key: 'ArrowDown', code: 'ArrowDown' })
  assert.equal(state(atlas).y, 17)
  runtime.input({ type: 'keyup', key: 'ArrowDown', code: 'ArrowDown' })

  runtime.update(0.64)
  assert.equal(state(atlas).y, 17)
  runtime.update(0.01)
  assert.equal(state(atlas).y, 16)

  runtime.input({ type: 'keydown', key: 'r', code: 'KeyR' })
  assert.deepEqual(state(atlas), {
    piece: 'I',
    x: 4,
    y: 18,
    rotation: 0,
    lines: 0,
    locks: 0,
    sequenceIndex: 1,
    gameOver: false,
  })
})


test('hard drop locks the first piece, clears one line, and advances sequence', async () => {
  const { atlas, runtime } = await loadTetris()

  runtime.input({ type: 'keydown', key: ' ', code: 'Space' })

  assert.deepEqual(state(atlas), {
    piece: 'T',
    x: 4,
    y: 18,
    rotation: 0,
    lines: 1,
    locks: 1,
    sequenceIndex: 2,
    gameOver: false,
  })
})


test('visible pointer controls route through the same game actions', async () => {
  const { atlas, runtime } = await loadTetris()

  runtime.input({ type: 'pointerdown', hitEntity: 10 })
  assert.equal(state(atlas).x, 3)
  runtime.input({ type: 'pointerdown', hitEntity: 11 })
  assert.equal(state(atlas).rotation, 1)
  runtime.input({ type: 'pointerdown', hitEntity: 12 })
  assert.equal(state(atlas).y, 17)
  runtime.input({ type: 'pointerdown', hitEntity: 15 })
  assert.equal(state(atlas).x, 4)
  assert.equal(state(atlas).y, 18)
  runtime.input({ type: 'pointerdown', hitEntity: 14 })
  assert.equal(state(atlas).x, 5)
  runtime.input({ type: 'pointerdown', hitEntity: 15 })
  runtime.input({ type: 'pointerdown', hitEntity: 13 })
  assert.equal(state(atlas).lines, 1)
  assert.equal(state(atlas).locks, 1)
})


test('held soft drop ignores key repeat and starts with a fresh timer', async () => {
  const { atlas, runtime } = await loadTetris()

  assert.equal(state(atlas).y, 18)
  runtime.update(0.6)
  assert.equal(state(atlas).y, 18)

  runtime.input({ type: 'keydown', key: 'ArrowDown', code: 'ArrowDown' })
  assert.equal(state(atlas).y, 17)
  runtime.input({
    type: 'keydown',
    key: 'ArrowDown',
    code: 'ArrowDown',
    repeat: true,
  })
  assert.equal(state(atlas).y, 17)

  runtime.update(0.001)
  assert.equal(state(atlas).y, 17)
  runtime.update(0.06)
  assert.equal(state(atlas).y, 16)

  runtime.input({ type: 'keyup', key: 'ArrowDown', code: 'ArrowDown' })
  runtime.update(0.64)
  assert.equal(state(atlas).y, 16)
  runtime.update(0.01)
  assert.equal(state(atlas).y, 15)
})

test('save restores board, counters, falling piece and gravity timing with released keys', async () => {
  const first = await loadTetris()
  first.runtime.input({ type: 'keydown', code: 'Space' })
  first.runtime.input({ type: 'keyup', code: 'Space' })
  first.runtime.input({ type: 'keydown', code: 'ArrowLeft' })
  first.runtime.update(0.4)
  const saved = first.runtime.snapshot()
  const next = await loadTetris()
  next.runtime.input({ type: 'keydown', code: 'ArrowDown' })
  next.runtime.restore(saved)
  assert.deepEqual(next.runtime.snapshot(), saved)
  assert.equal(next.runtime.pressedKeys.size, 0)
  assert.deepEqual(state(next.atlas), state(first.atlas))
  next.runtime.update(0.26)
  assert.equal(state(next.atlas).y, state(first.atlas).y - 1)
  const invalid = structuredClone(saved)
  invalid.scripts[0].state.board[0][0] = 'unknown'
  assert.throws(() => next.runtime.restore(invalid), /Invalid Tetris save/)
})
