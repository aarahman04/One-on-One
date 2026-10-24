import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { default: express } = await import('express')
const { supabaseAdmin } = await import('../src/database/supabaseAdmin.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { connectionsRouter } = await import('../src/routes/connections.js')
const { ConnectionError } = await import('../src/services/connectionService.js')
const { createSocketServer } = await import('../src/websocket/socketServer.js')
const { RACKET_MAX, RACKET_MIN, WIN_SCORE } = await import('../src/games/pong.js')

const { io: connect } = createRequire(new URL('../../client/package.json', import.meta.url))('socket.io-client')

// Two real Socket.IO clients against the real server: the authoritative match flow end to end.

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const CONN = '11111111-1111-4111-8111-111111111111'
const users = [A, B, C]
const tokenOf = (id: string) => `tok-${users.indexOf(id)}`
const waitFor = async (ready: () => boolean, ms = 3000) => {
  for (let i = 0; i < ms / 10; i++) {
    if (ready()) return
    await delay(10)
  }
  assert.fail('timed out')
}

function seed() {
  const db = installFakeSupabase(supabaseAdmin)
  db.tables.users = users.map((id, i) => ({ id, auth_user_id: `auth-${i}`, connection_code: `CODE000${i}`, age_verified_at: null, terms_accepted_at: null }))
  users.forEach((_, i) => db.authUsers.set(`tok-${i}`, `auth-${i}`))
  db.tables.connections = [{
    id: CONN, user_a_id: A, user_b_id: B, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    wallpaper: 'off', message_style: 'bubbles', ended_at: null, ended_by: null,
  }]
  db.tables.connection_members = [
    { connection_id: CONN, user_id: A, nickname: 'Bee', leave_step: 0, leave_last_step_at: null },
    { connection_id: CONN, user_id: B, nickname: 'Ay', leave_step: 0, leave_last_step_at: null },
  ]
  db.tables.messages = []
  return db
}

async function server(t: TestContext) {
  const app = express()
  app.use(express.json())
  app.use('/api', connectionsRouter)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ConnectionError) return void res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: 'internal server error' })
  })
  const http = createServer(app)
  const io = createSocketServer(http, ['http://localhost'])
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  const clients: ReturnType<typeof connect>[] = []
  t.after(async () => {
    for (const c of clients) c.disconnect()
    await new Promise<void>((resolve) => io.close(() => resolve()))
  })
  const socket = async (user: string) => {
    const client = connect(base, { auth: { token: tokenOf(user) }, reconnection: false })
    clients.push(client)
    const states: any[] = []
    const frames: any[] = []
    client.on('match:state', (s: unknown) => states.push(s))
    client.on('match:pong', (f: unknown) => frames.push(f))
    await waitFor(() => client.connected)
    await delay(30)
    const emit = (name: string, data?: unknown) => new Promise<any>((resolve) => client.emit(name, data, (res: unknown) => resolve(res)))
    return { client, states, frames, emit, last: () => states.at(-1) }
  }
  const api = (user: string, method: string, path: string) =>
    fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${tokenOf(user)}` } })
  return { socket, api }
}

test('chess between two clients: same seats, server-validated moves, both see identical state, reconnect restores the board', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A)
  let b = await socket(B)
  const carol = await socket(C)

  const invite = await a.emit('match:invite', { game: 'chess' })
  assert.equal(invite.ok, true)
  const id = invite.match.id
  await waitFor(() => b.last()?.id === id)
  assert.equal(b.last().status, 'invited')
  assert.equal(carol.states.length, 0)
  assert.deepEqual(await carol.emit('match:accept', { matchId: id }), { ok: false, error: 'not_member' })
  assert.equal((await a.emit('match:accept', { matchId: id })).error, 'bad_state')

  const started = await b.emit('match:accept', { matchId: id })
  assert.equal(started.match.status, 'playing')
  await waitFor(() => a.last()?.status === 'playing')
  // Exactly one white (seat 1) and one black, and both clients agree.
  assert.deepEqual(a.last().players, b.last().players)
  assert.deepEqual([...a.last().players].sort(), [A, B])
  const white = a.last().players[0] === A ? a : b
  const black = white === a ? b : a

  assert.equal((await black.emit('match:move', { matchId: id, seq: 0, move: { uci: 'e7e5' } })).error, 'not_your_turn')
  assert.equal((await white.emit('match:move', { matchId: id, seq: 0, move: { uci: 'e2e5' } })).error, 'illegal_move')
  assert.equal((await white.emit('match:move', { matchId: id, seq: 0, move: { uci: 'f2f3' } })).ok, true)
  // A resent move (lost ack) is not applied twice.
  assert.equal((await white.emit('match:move', { matchId: id, seq: 0, move: { uci: 'f2f3' } })).ok, true)
  assert.equal((await black.emit('match:move', { matchId: id, seq: 1, move: { uci: 'e7e5' } })).ok, true)

  // Black drops and comes back: the board is restored from the server.
  const blackUser = black === a ? A : B
  black.client.disconnect()
  await waitFor(() => white.last()?.away?.includes(blackUser))
  const back = await socket(blackUser)
  const synced = await back.emit('match:sync')
  assert.equal(synced.match.seq, 2)
  assert.equal(synced.match.board.fen, 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2')
  if (black === b) b = back

  assert.equal((await white.emit('match:move', { matchId: id, seq: 2, move: { uci: 'g2g4' } })).ok, true)
  const mate = await back.emit('match:move', { matchId: id, seq: 3, move: { uci: 'd8h4' } })
  assert.deepEqual(mate.match.outcome, { winner: blackUser, reason: 'checkmate' })
  await waitFor(() => white.last()?.status === 'over' && back.last()?.status === 'over')
  assert.deepEqual(white.last(), back.last())
  assert.equal((await white.emit('match:move', { matchId: id, seq: 4, move: { uci: 'a2a3' } })).error, 'game_over')

  // Rematch: both ask, colours swap.
  await white.emit('match:rematch', { matchId: id })
  const re = await back.emit('match:rematch', { matchId: id })
  assert.equal(re.match.status, 'playing')
  assert.equal(re.match.players[0], blackUser)
  assert.equal(re.match.series[blackUser], 1)
})

test('ping pong between two clients: one server simulation, identical frames, paddles, scoring', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A)
  const b = await socket(B)
  const id = (await a.emit('match:invite', { game: 'pong' })).match.id
  await waitFor(() => b.last()?.id === id)
  await b.emit('match:accept', { matchId: id })
  const seatOfA = (await a.emit('match:sync')).match.players[0] === A ? 0 : 1
  // Both paddles parked in a corner so the first serve is missed.
  a.client.emit('match:paddle', { matchId: id, x: RACKET_MIN })
  b.client.emit('match:paddle', { matchId: id, x: RACKET_MAX })
  await waitFor(() => a.frames.length > 10 && b.frames.length > 10)
  const last = a.frames.at(-1)
  assert.equal(last.p[seatOfA], RACKET_MIN)
  assert.equal(last.p[1 - seatOfA], RACKET_MAX)
  // Same frames on both clients (match by server time).
  const shared = a.frames.filter((f) => b.frames.some((g) => g.t === f.t))
  assert.ok(shared.length > 5)
  for (const f of shared) assert.deepEqual(f, b.frames.find((g) => g.t === f.t))
  // Countdown, then the ball moves, then a point is scored and the ball resets.
  await waitFor(() => a.frames.at(-1).s[0] + a.frames.at(-1).s[1] === 1, 15000)
  const scored = a.frames.find((f) => f.s[0] + f.s[1] === 1)
  assert.deepEqual(scored.b.slice(2), [0, 0])
  assert.ok(scored.c > 0)
  // Frame rate stays at ~30/s (not one packet per display frame).
  const span = (a.frames.at(-1).t - a.frames[0].t) / 1000
  assert.ok(a.frames.length / span < 36, `${a.frames.length / span} frames/s`)
  assert.equal((await a.emit('match:resign', { matchId: id })).match.outcome.reason, 'resigned')
  await waitFor(() => b.last()?.status === 'over')
})

test('timed paddle windows are validated atomically and acked on the server clock over real sockets', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A), b = await socket(B), outsider = await socket(C)
  const id = (await a.emit('match:invite', { game: 'pong' })).match.id
  await b.emit('match:accept', { matchId: id })
  await waitFor(() => a.frames.length > 0)
  const seat = a.last().players[0] === A ? 0 : 1
  const y = seat === 0 ? 2.4 : -.6, v = a.frames.at(-1).t
  const packet = { matchId: id, x: .4, y, ct: 1032, v, n: 3,
    samples: [[1, 1000, v, .2, y, .2, y, 0], [2, 1016, v, .3, y, .3, y, 1]] }
  const malformed = [
    { ...packet, samples: Array(33).fill(packet.samples[0]) },
    { ...packet, samples: [[...packet.samples[0]], [2, 1016, v, .3, y, .3, y, 2]] },
    { ...packet, samples: [packet.samples[1], packet.samples[0]] },
    { ...packet, samples: [[1, 1000, v + 1, .2, y, .2, y, 0]] },
    { ...packet, ct: undefined },
    { ...packet, samples: [[1, -1, v, .2, y, .2, y, 0]] },
  ]
  for (const bad of malformed) a.client.emit('match:paddle', bad)
  outsider.client.emit('match:paddle', packet)
  await delay(80)
  assert.equal(a.frames.at(-1).ack[seat], 0, 'malformed windows and outsiders do not mutate a match')
  a.client.emit('match:paddle', packet)
  await waitFor(() => a.frames.at(-1).ack[seat] === 3)
  assert.equal(a.frames.at(-1).p[seat], .4)
  a.client.emit('match:paddle', { ...packet, x: .9, ct: 1031, n: 4, samples: [] })
  a.client.emit('match:paddle', { ...packet, x: .9, ct: 1040, n: 2, samples: [] })
  await delay(80)
  assert.equal(a.frames.at(-1).ack[seat], 3)
  assert.equal(a.frames.at(-1).p[seat], .4)
  assert.ok(a.frames.every((f, i) => !i || f.t >= a.frames[i - 1].t))
})

test('ping pong over real sockets: two-dimensional rackets rally, missing returns loses, rematch resets', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A)
  const b = await socket(B)
  const id = (await a.emit('match:invite', { game: 'pong' })).match.id
  await waitFor(() => b.last()?.id === id)
  await b.emit('match:accept', { matchId: id })
  // Each bot sees only the frames it receives (with real socket latency) and
  // sends its racket at ~30/s, like the app: it moves towards where the ball is.
  const active = new Map([[a, true], [b, true]])
  const bots = [a, b].map((bot) =>
    setInterval(() => {
      const f = bot.frames.at(-1)
      if (!f) return
      const seat = bot.last()?.players[0] === (bot === a ? A : B) ? 1 : 2
      const serving = f.serve === seat
      // An inactive returner still serves: otherwise the reference waits for contact forever.
      bot.client.emit('match:paddle', { matchId: id,
        x: serving || active.get(bot) ? f.b[0] : RACKET_MIN,
        y: serving ? f.b[1] : seat === 1 ? 1.88 : -0.08, released: true })
    }, 33),
  )
  t.after(() => bots.forEach(clearInterval))
  await delay(3000 + 9000) // serve countdown, then 9 s of play
  const rally = a.frames.at(-1)
  assert.deepEqual(rally.s, [0, 0], 'nobody missed')
  assert.ok(rally.h >= 5, `${rally.h} returns`)
  // B stops returning: A wins every point until the match ends at 7.
  active.set(b, false)
  b.client.emit('match:paddle', { matchId: id, x: RACKET_MIN })
  const bSeat = (await b.emit('match:sync')).match.players[0] === B ? 0 : 1
  await waitFor(() => a.last()?.status === 'over', 60_000)
  const end = a.last()
  assert.equal(end.outcome.winner, A)
  assert.equal(end.outcome.reason, 'first_to_7')
  const score = a.frames.at(-1).s
  assert.equal(score[1 - bSeat], WIN_SCORE)
  assert.deepEqual(b.last(), end, 'both clients agree on the result')
  // Rematch from both: a fresh game with sides swapped.
  await a.emit('match:rematch', { matchId: id })
  const re = await b.emit('match:rematch', { matchId: id })
  assert.equal(re.match.status, 'playing')
  assert.equal(re.match.series[A], 1)
})

test('an offline partner receives a pending invite on reconnect; leaving the connection ends the match', async (t) => {
  seed()
  const { socket, api } = await server(t)
  const a = await socket(A)
  const offline = await a.emit('match:invite', { game: 'chess' })
  assert.equal(offline.ok, true)
  assert.equal(offline.match.status, 'invited')
  assert.equal((await a.emit('match:invite', { game: 'chess' })).error, 'busy')
  assert.equal((await a.emit('match:invite', { game: 'poker' })).error, 'invalid_payload')
  const b = await socket(B)
  assert.equal((await b.emit('match:sync')).match.id, offline.match.id)
  assert.equal((await b.emit('match:accept', { matchId: offline.match.id })).ok, true)
  await a.emit('match:resign', { matchId: offline.match.id })
  const id = (await a.emit('match:invite', { game: 'dots' })).match.id
  await b.emit('match:accept', { matchId: id })
  assert.equal((await api(A, 'POST', `/connections/${CONN}/leave`)).status, 200)
  await waitFor(() => b.last()?.outcome?.reason === 'connection_ended')
  assert.equal((await b.emit('match:sync')).error, 'connection_inactive')
})

test('a played game is logged to chat history; an unanswered invite is not', async (t) => {
  const db = seed()
  const { socket } = await server(t)
  const a = await socket(A)
  const b = await socket(B)
  const logs: any[] = []
  b.client.on('message:new', (m: any) => { if (m.type === 'game') logs.push(m) })

  const declined = await a.emit('match:invite', { game: 'tictactoe' })
  assert.equal((await b.emit('match:decline', { matchId: declined.match.id })).ok, true)

  const invited = await a.emit('match:invite', { game: 'tictactoe' })
  const started = await b.emit('match:accept', { matchId: invited.match.id })
  const [first, second] = started.match.players as [string, string]
  const by = (id: string) => (id === A ? a : b)
  // Seat 1 takes the top row while seat 2 plays the middle row.
  const moves = [[first, 0], [second, 3], [first, 1], [second, 4], [first, 2]] as const
  for (const [seq, [player, cell]] of moves.entries()) {
    const res = await by(player).emit('match:move', { matchId: invited.match.id, seq, move: { cell } })
    assert.equal(res.ok, true, JSON.stringify(res))
  }
  await waitFor(() => logs.length === 1)
  assert.equal(logs[0].senderId, A)
  assert.equal(logs[0].content, 'Played Tic-Tac-Toe · 0 sec')
  assert.deepEqual({ ...logs[0].payload, durationSec: 0 }, { game: 'tictactoe', inviter: A, winner: first, reason: 'three_in_a_row', durationSec: 0 })
  assert.equal(db.tables.messages.filter((m: any) => m.type === 'game').length, 1)
})

test('in-game reactions reach both players, are bounded and throttled, and need a live match', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A)
  const b = await socket(B)
  const carol = await socket(C)
  const seen: Record<string, any[]> = { a: [], b: [], carol: [] }
  a.client.on('match:reaction', (r: unknown) => seen.a.push(r))
  b.client.on('match:reaction', (r: unknown) => seen.b.push(r))
  carol.client.on('match:reaction', (r: unknown) => seen.carol.push(r))

  const id = (await a.emit('match:invite', { game: 'tictactoe' })).match.id
  assert.equal((await a.emit('match:react', { matchId: id, text: '🔥' })).error, 'bad_state', 'not while only invited')
  await b.emit('match:accept', { matchId: id })

  assert.deepEqual(await a.emit('match:react', { matchId: id, text: '  Nice\n move!  ' }), { ok: true, match: null })
  await waitFor(() => seen.a.length === 1 && seen.b.length === 1)
  assert.equal(seen.b[0].text, 'Nice move!')
  assert.equal(seen.b[0].from, A)
  assert.equal(seen.b[0].matchId, id)
  assert.equal(typeof seen.b[0].id, 'string')

  assert.equal((await a.emit('match:react', { matchId: id, text: 'again' })).error, 'rate_limited')
  assert.equal((await b.emit('match:react', { matchId: id, text: 'x'.repeat(61) })).error, 'invalid_payload')
  assert.equal((await b.emit('match:react', { matchId: id, text: '   ' })).error, 'invalid_payload')
  assert.equal((await b.emit('match:react', { matchId: id, text: '👍'.repeat(60) })).ok, true, 'emoji count as one character each')
  assert.equal((await b.emit('match:react', { matchId: 'other', text: 'hi' })).error, 'not_found')
  assert.equal((await carol.emit('match:react', { matchId: id, text: 'hi' })).error, 'not_member')
  await delay(50)
  assert.equal(seen.carol.length, 0)
})


test('all turn games keep chosen clocks, increments and comments through real Socket.IO', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A), b = await socket(B)
  const comments: any[] = []
  b.client.on('match:reaction', (value: unknown) => comments.push(value))
  for (const game of ['chess', 'tictactoe', 'connect4', 'reversi']) {
    const invited = await a.emit('match:invite', { game, clock: { base: 60000, inc: 2000 } })
    assert.deepEqual(invited.match.clock, { base: 60000, inc: 2000, left: [60000, 60000] }, game)
    const id = invited.match.id
    await waitFor(() => b.last()?.id === id)
    assert.deepEqual(b.last().clock, invited.match.clock)
    await b.emit('match:accept', { matchId: id })
    await delay(150)
    const synced = (await a.emit('match:sync')).match
    assert.ok(synced.clock.left[0] < 60000 && synced.clock.left[0] > 57000, game)
    assert.equal(synced.clock.left[1], 60000)
    const mover = synced.players[0] === A ? a : b
    const move = game === 'chess' ? { uci: 'e2e4' } : game === 'connect4' ? { col: 3 } :
      { cell: game === 'reversi' ? synced.board.legal[0] : 4 }
    const moved = await mover.emit('match:move', { matchId: id, seq: 0, move })
    assert.equal(moved.ok, true, game)
    assert.ok(moved.match.clock.left[0] > 60000, 'mover receives the 2 s increment')
    await waitFor(() => b.last()?.seq === 1)
    assert.equal(b.last().turn, synced.players[1])
    await delay(710)
    assert.equal((await a.emit('match:react', { matchId: id, text: `Checked ${game}` })).ok, true)
    await waitFor(() => comments.some(c => c.matchId === id && c.text === `Checked ${game}`))
    await a.emit('match:resign', { matchId: id })
  }
})

test('a real server clock expires without either client making another move', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A), b = await socket(B)
  const invited = await a.emit('match:invite', { game: 'tictactoe', clock: { base: 10000, inc: 0 } })
  const id = invited.match.id
  await b.emit('match:accept', { matchId: id })
  await waitFor(() => a.last()?.status === 'over' && b.last()?.status === 'over', 13000)
  assert.deepEqual(a.last().outcome, { winner: invited.match.players[1], reason: 'timeout' })
  assert.equal(a.last().clock.left[0], 0)
  assert.deepEqual(a.last(), b.last())
})

test('Pong 11, 21 and custom targets survive the real socket contract and allow comments', async (t) => {
  seed()
  const { socket } = await server(t)
  const a = await socket(A), b = await socket(B)
  const comments: any[] = []
  b.client.on('match:reaction', (value: unknown) => comments.push(value))
  for (const points of [11, 21, 13]) {
    const invited = await a.emit('match:invite', { game: 'pong', points })
    assert.equal(invited.match.points, points)
    const id = invited.match.id
    const accepted = await b.emit('match:accept', { matchId: id })
    assert.equal(accepted.match.points, points)
    assert.equal(accepted.match.board.target, points)
    assert.equal(accepted.match.clock, null, 'Pong is score-based')
    assert.equal((await a.emit('match:sync')).match.points, points)
    await delay(710)
    assert.equal((await a.emit('match:react', { matchId: id, text: `First to ${points}` })).ok, true)
    await waitFor(() => comments.some(c => c.matchId === id && c.text === `First to ${points}`))
    await a.emit('match:resign', { matchId: id })
    await a.emit('match:rematch', { matchId: id })
    const rematch = await b.emit('match:rematch', { matchId: id })
    assert.equal(rematch.match.points, points)
    assert.equal(rematch.match.board.target, points)
    await a.emit('match:resign', { matchId: rematch.match.id })
  }
})
