import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)
const config = JSON.parse(await readFile(new URL('pocketrealms.json', root)))
const { loadProject, ScriptRuntime } = await import(new URL(`.runtime/${config.runtime.build}/test-runtime.js`, root))
const dt = 1 / 60
async function fixture() {
  const project = await loadProject(path => readFile(new URL(path, root), 'utf8'))
  const script = project.scripts[0]
  const url = new URL(script.source, root); url.searchParams.set('instance',crypto.randomUUID())
  const {default:behavior} = await import(url)
  const entities = new Map(project.scene.entities.map(entity=>[entity.id,structuredClone(entity)]))
  const atlas = { getEntity: id=>structuredClone(entities.get(id)), setEntity: entity=>entities.set(entity.id,structuredClone(entity)), removeEntity:id=>entities.delete(id) }
  const runtime = new ScriptRuntime(atlas,[{...script,behavior}],()=>{}, { inputs:project.inputs })
  runtime.start()
  const state=()=>JSON.parse(atlas.getEntity(20).name.slice('Tetris state '.length))
  const step=(n=1)=>{for(let i=0;i<n;i++)runtime.update(dt)}
  const key=(code,down=true,repeat=false)=>runtime.input({type:down?'keydown':'keyup',code,repeat})
  const press=code=>{key(code);key(code,false);step()}
  return {project,entities,runtime,state,step,key,press}
}
test('deterministic board loads the independent shared-input definition',async()=>{
  const f=await fixture()
  assert.ok(f.project.dependencies.has('inputs.json'))
  assert.equal([...f.entities.keys()].filter(id=>id>=100&&id<300).length,200)
  assert.deepEqual(f.state(),{piece:'I',x:4,y:18,rotation:0,lines:0,locks:0,sequenceIndex:1,gameOver:false})
})
test('quick keyboard presses are delivered on ticks for movement, rotation and reset',async()=>{
  const f=await fixture();f.key('ArrowLeft');f.key('ArrowLeft',false)
  assert.equal(f.state().x,4);f.step();assert.equal(f.state().x,3)
  f.press('ArrowUp');assert.equal(f.state().rotation,1)
  f.press('ArrowDown');assert.equal(f.state().y,17)
  f.press('KeyR');assert.equal(f.state().x,4);assert.equal(f.state().y,18)
  assert.equal(f.runtime.controls.inspect().sources.length,0)
})
test('hard drop clears a line and advances the deterministic piece sequence',async()=>{
  const f=await fixture();f.press('Space')
  assert.equal(f.state().lines,1);assert.equal(f.state().locks,1);assert.equal(f.state().piece,'P')
})
test('touch-shaped sources and keys invoke identical game rules',async()=>{
  const f=await fixture()
  const tap=id=>{f.runtime.controls.setSource({device:'widget',input:id},'finger',true);f.runtime.controls.releaseSource('finger');f.step()}
  tap('left');assert.equal(f.state().x,3)
  tap('rotate');assert.equal(f.state().rotation,1)
  tap('reset');tap('hard-drop');assert.equal(f.state().lines,1)
})
test('shared hold repeat ignores OS repeat and independent release retains a finger',async()=>{
  const f=await fixture();f.key('ArrowRight');f.step();assert.equal(f.state().x,5)
  for(let i=0;i<10;i++){f.key('ArrowRight',true,true);f.step()}
  assert.equal(f.state().x,5)
  f.runtime.controls.setSource({device:'widget',input:'right'},'finger',true)
  f.key('ArrowRight',false);f.step(9);assert.ok(f.state().x>5)
  f.runtime.controls.releaseSource('finger');f.step();const x=f.state().x;f.step(30);assert.equal(f.state().x,x)
})
test('soft drop is held consistently by keyboard and touch, then returns to gravity',async()=>{
  const f=await fixture();f.key('ArrowDown');f.step();assert.equal(f.state().y,17)
  f.step(4);assert.equal(f.state().y,16)
  f.runtime.controls.setSource({device:'widget',input:'soft-drop'},'finger',true)
  f.key('ArrowDown',false);f.step(4);assert.equal(f.state().y,15)
  f.runtime.controls.releaseSource('finger');f.step();const y=f.state().y;f.step(20);assert.equal(f.state().y,y)
})
test('same-release save restores board, sequence and timers with neutral input',async()=>{
  const f=await fixture();f.press('Space');f.key('ArrowLeft');f.step(8)
  const saved=f.runtime.snapshot(), next=await fixture();next.key('ArrowDown');next.runtime.restore(saved)
  assert.deepEqual(next.runtime.snapshot(),saved);assert.deepEqual(next.state(),f.state())
  assert.equal(next.runtime.controls.inspect().sources.length,0)
  const broken=structuredClone(saved);broken.scripts[0].state.board[0][0]='unknown'
  assert.throws(()=>next.runtime.restore(broken),/Invalid Tetris save/)
})
test('P piece keeps all five cells after rotation, wall kicks, save and drop',async()=>{
  const f=await fixture();f.press('Space');f.press('ArrowUp');for(let i=0;i<10;i++)f.press('ArrowLeft')
  assert.equal(f.state().x,1);assert.equal(f.state().rotation,1)
  const next=await fixture();next.runtime.restore(f.runtime.snapshot())
  for(const current of [f,next]){current.press('Space');assert.equal(current.runtime.snapshot().scripts[0].state.board.flat().filter(c=>c==='P').length,5)}
  assert.deepEqual(next.runtime.snapshot(),f.runtime.snapshot())
})
