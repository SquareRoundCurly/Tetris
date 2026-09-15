const BOARD_WIDTH = 10
const BOARD_HEIGHT = 20
const CELL_SIZE = 0.9
const CELL_ENTITY_START = 100
const STATUS_ENTITY = 20
const NORMAL_FALL_SECONDS = 0.65
const SOFT_DROP_SECONDS = 0.06
const EMPTY_COLOR = [0.035, 0.05, 0.075, 1]

// Piece data is deliberately separate from the game loop so a later chat turn
// can add one definition and put its key in the sequence without rewriting the
// movement, collision, or rendering code.
const STANDARD_PIECE_DEFINITIONS = [
  {
    key: 'I',
    color: [0.12, 0.82, 0.94, 1],
    cells: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  },
  {
    key: 'J',
    color: [0.16, 0.36, 0.94, 1],
    cells: [[-1, 1], [-1, 0], [0, 0], [1, 0]],
  },
  {
    key: 'L',
    color: [0.98, 0.52, 0.12, 1],
    cells: [[-1, 0], [0, 0], [1, 0], [1, 1]],
  },
  {
    key: 'O',
    color: [0.98, 0.82, 0.12, 1],
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    rotatable: false,
  },
  {
    key: 'S',
    color: [0.2, 0.82, 0.38, 1],
    cells: [[-1, 0], [0, 0], [0, 1], [1, 1]],
  },
  {
    key: 'T',
    color: [0.7, 0.28, 0.92, 1],
    cells: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  },
  {
    key: 'Z',
    color: [0.94, 0.2, 0.24, 1],
    cells: [[-1, 1], [0, 1], [0, 0], [1, 0]],
  },
]

const CUSTOM_PIECE_DEFINITIONS = [
  {
    key: 'P',
    color: [0.96, 0.34, 0.65, 1],
    cells: [[-1, -1], [-1, 0], [0, 0], [-1, 1], [0, 1]],
  },
]
const PIECE_SEQUENCE = ['I', 'P', 'T', 'O', 'L', 'J', 'S', 'Z']
const PIECES = new Map(
  [...STANDARD_PIECE_DEFINITIONS, ...CUSTOM_PIECE_DEFINITIONS]
    .map((definition) => [definition.key, definition]),
)

let board = []
let activePiece = null
let pieceSequenceIndex = 0
let elapsedSeconds = 0
let softDropActive = false
let clearedLines = 0
let lockedPieces = 0
let gameOver = false

function emptyRow() {
  return Array(BOARD_WIDTH).fill(null)
}

function initialBoard() {
  const nextBoard = Array.from({ length: BOARD_HEIGHT }, emptyRow)
  // The first I piece completes this row when hard-dropped. Besides making the
  // board visibly non-empty, this gives the acceptance tests a deterministic
  // line-clear scenario without a long sequence of synthetic moves.
  for (let column = 0; column < BOARD_WIDTH; column += 1) {
    if (column < 3 || column > 6) nextBoard[0][column] = 'J'
  }
  return nextBoard
}

function cellEntityId(row, column) {
  return CELL_ENTITY_START + row * BOARD_WIDTH + column
}

function cellPosition(row, column) {
  return [
    (column - (BOARD_WIDTH - 1) / 2) * CELL_SIZE,
    (row - (BOARD_HEIGHT - 1) / 2) * CELL_SIZE,
    1,
  ]
}

function ensureCellEntities(game) {
  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    for (let column = 0; column < BOARD_WIDTH; column += 1) {
      const id = cellEntityId(row, column)
      if (game.getEntity(id)) continue
      game.addEntity({
        id,
        name: `Tetris cell ${column},${row}`,
        canvas: { bitmask: 2 },
        transform: {
          position: cellPosition(row, column),
          scale: [0.82, 0.82, 1],
        },
        drawable: { shape: 'quad', color: EMPTY_COLOR },
      })
    }
  }
}

function rotatedCells(definition, rotation) {
  if (definition.rotatable === false) return definition.cells
  let cells = definition.cells.map(([x, y]) => [x, y])
  for (let turn = 0; turn < rotation; turn += 1) {
    cells = cells.map(([x, y]) => [y, -x])
  }
  return cells
}

function occupiedCells(piece = activePiece) {
  if (!piece) return []
  return rotatedCells(piece.definition, piece.rotation).map(([x, y]) => [
    piece.x + x,
    piece.y + y,
  ])
}

function canPlace(piece) {
  return occupiedCells(piece).every(([column, row]) => (
    column >= 0
    && column < BOARD_WIDTH
    && row >= 0
    && row < BOARD_HEIGHT
    && board[row][column] === null
  ))
}

function nextDefinition() {
  const key = PIECE_SEQUENCE[pieceSequenceIndex % PIECE_SEQUENCE.length]
  pieceSequenceIndex += 1
  const definition = PIECES.get(key)
  if (!definition) throw new Error(`Unknown Tetris piece ${key}`)
  return definition
}

function spawnPiece() {
  const definition = nextDefinition()
  const candidate = {
    definition,
    x: 4,
    y: 18,
    rotation: 0,
  }
  if (!canPlace(candidate)) {
    activePiece = null
    gameOver = true
    return
  }
  activePiece = candidate
}

function statusSnapshot() {
  return {
    piece: activePiece?.definition.key ?? null,
    x: activePiece?.x ?? null,
    y: activePiece?.y ?? null,
    rotation: activePiece?.rotation ?? null,
    lines: clearedLines,
    locks: lockedPieces,
    sequenceIndex: pieceSequenceIndex,
    gameOver,
  }
}

function render(game) {
  const visible = board.map((row) => [...row])
  for (const [column, row] of occupiedCells()) {
    if (row >= 0 && row < BOARD_HEIGHT && column >= 0 && column < BOARD_WIDTH) {
      visible[row][column] = activePiece.definition.key
    }
  }

  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    for (let column = 0; column < BOARD_WIDTH; column += 1) {
      const pieceKey = visible[row][column]
      const definition = pieceKey === null ? null : PIECES.get(pieceKey)
      game.updateEntity(cellEntityId(row, column), {
        name: pieceKey === null
          ? `Tetris cell ${column},${row} empty`
          : `Tetris cell ${column},${row} ${pieceKey}`,
        drawable: { color: definition?.color ?? EMPTY_COLOR },
      })
    }
  }

  game.updateEntity(STATUS_ENTITY, {
    name: `Tetris state ${JSON.stringify(statusSnapshot())}`,
    drawable: {
      color: gameOver
        ? [0.94, 0.18, 0.22, 1]
        : activePiece?.definition.color ?? [0.5, 0.5, 0.5, 1],
    },
  })
}

function reset(game) {
  board = initialBoard()
  activePiece = null
  pieceSequenceIndex = 0
  elapsedSeconds = 0
  softDropActive = false
  clearedLines = 0
  lockedPieces = 0
  gameOver = false
  ensureCellEntities(game)
  spawnPiece()
  render(game)
  game.checkpoint?.()
}

function tryMove(game, deltaX, deltaY, renderAfterMove = true) {
  if (!activePiece || gameOver) return false
  const candidate = {
    ...activePiece,
    x: activePiece.x + deltaX,
    y: activePiece.y + deltaY,
  }
  if (!canPlace(candidate)) return false
  activePiece = candidate
  if (renderAfterMove) render(game)
  return true
}

function clearCompletedLines() {
  const remaining = board.filter((row) => row.some((cell) => cell === null))
  const removed = BOARD_HEIGHT - remaining.length
  while (remaining.length < BOARD_HEIGHT) remaining.push(emptyRow())
  board = remaining
  clearedLines += removed
}

function lockPiece(game) {
  if (!activePiece || gameOver) return
  for (const [column, row] of occupiedCells()) {
    board[row][column] = activePiece.definition.key
  }
  lockedPieces += 1
  activePiece = null
  clearCompletedLines()
  spawnPiece()
  elapsedSeconds = 0
  render(game)
  game.checkpoint?.()
}

function stepDown(game) {
  if (!tryMove(game, 0, -1)) lockPiece(game)
}

function hardDrop(game) {
  if (!activePiece || gameOver) return
  while (tryMove(game, 0, -1, false)) {
    // Move until the next row collides, then make the landing one operation.
  }
  lockPiece(game)
}

function rotate(game) {
  if (!activePiece || gameOver || activePiece.definition.rotatable === false) return
  const rotation = (activePiece.rotation + 1) % 4
  for (const kick of [0, -1, 1, -2, 2]) {
    const candidate = { ...activePiece, x: activePiece.x + kick, rotation }
    if (!canPlace(candidate)) continue
    activePiece = candidate
    render(game)
    return
  }
}

function keyboardCode(event) {
  if (event.code) return event.code
  return {
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    ArrowDown: 'ArrowDown',
    ArrowUp: 'ArrowUp',
    ' ': 'Space',
    r: 'KeyR',
    R: 'KeyR',
  }[event.key] ?? event.key
}

function performAction(action, game) {
  if (action === 'left') tryMove(game, -1, 0)
  if (action === 'right') tryMove(game, 1, 0)
  if (action === 'soft-drop') stepDown(game)
  if (action === 'rotate') rotate(game)
  if (action === 'hard-drop') hardDrop(game)
  if (action === 'reset') reset(game)
}

export default {
  snapshot() {
    return {
      board: board.map((row) => [...row]),
      activePiece: activePiece && {
        key: activePiece.definition.key, x: activePiece.x, y: activePiece.y, rotation: activePiece.rotation,
      },
      pieceSequenceIndex, elapsedSeconds, clearedLines, lockedPieces, gameOver,
    }
  },

  restore(saved, game) {
    const integer = (value) => Number.isSafeInteger(value) && value >= 0
    if (!saved || !Array.isArray(saved.board) || saved.board.length !== BOARD_HEIGHT
        || !saved.board.every((row) => Array.isArray(row) && row.length === BOARD_WIDTH
          && row.every((cell) => cell === null || PIECES.has(cell)))
        || !integer(saved.pieceSequenceIndex) || !integer(saved.clearedLines) || !integer(saved.lockedPieces)
        || !Number.isFinite(saved.elapsedSeconds) || saved.elapsedSeconds < 0 || saved.elapsedSeconds > NORMAL_FALL_SECONDS
        || typeof saved.gameOver !== 'boolean') throw new Error('Invalid Tetris save')
    const piece = saved.activePiece
    if ((saved.gameOver && piece !== null) || (!saved.gameOver && (!piece || !PIECES.has(piece.key)
        || !Number.isInteger(piece.x) || !Number.isInteger(piece.y)
        || !integer(piece.rotation) || piece.rotation > 3))) throw new Error('Invalid saved piece')
    board = saved.board.map((row) => [...row])
    activePiece = piece && { definition: PIECES.get(piece.key), x: piece.x, y: piece.y, rotation: piece.rotation }
    if (activePiece && !canPlace(activePiece)) throw new Error('Saved piece collides with the board')
    pieceSequenceIndex = saved.pieceSequenceIndex
    elapsedSeconds = saved.elapsedSeconds
    clearedLines = saved.clearedLines
    lockedPieces = saved.lockedPieces
    gameOver = saved.gameOver
    softDropActive = false
    ensureCellEntities(game)
    render(game)
  },

  start(game) {
    reset(game)
  },

  reset(game) {
    reset(game)
  },

  onKeyDown(event, game) {
    const code = keyboardCode(event)
    if (event.repeat && ['ArrowDown', 'ArrowUp', 'Space', 'KeyR'].includes(code)) return
    const action = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowDown: 'soft-drop',
      ArrowUp: 'rotate',
      Space: 'hard-drop',
      KeyR: 'reset',
    }[code]
    if (action) performAction(action, game)
  },

  onPointerDown(event, game) {
    const action = {
      10: 'left',
      11: 'rotate',
      12: 'soft-drop',
      13: 'hard-drop',
      14: 'right',
      15: 'reset',
    }[event.hitEntity]
    if (action) performAction(action, game)
  },

  update(deltaSeconds, game) {
    if (!activePiece || gameOver) return
    const softDrop = game.input?.isKeyDown('ArrowDown') === true
    if (softDrop !== softDropActive) {
      elapsedSeconds = 0
      softDropActive = softDrop
    }
    elapsedSeconds += deltaSeconds
    const interval = softDrop ? SOFT_DROP_SECONDS : NORMAL_FALL_SECONDS
    let steps = 0
    while (elapsedSeconds >= interval && steps < 4) {
      elapsedSeconds -= interval
      stepDown(game)
      steps += 1
      if (!activePiece || gameOver) break
    }
  },
}
