import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`'${from}'`, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const enginesUrl = await source('../src/features/games/engines.ts', { 'chess.js': pathToFileURL(require.resolve('chess.js')).href })
const { TicTacToeGame, ConnectFourGame, DotsGame, ChessGame, PongGame } = await import(enginesUrl)
const { GameSession } = await import(await source('../src/features/games/session.ts', { './engines': enginesUrl }))
const { planLetterPages, chooseLetterSize } = await import(await source('../src/features/letterLayout.ts'))
const { archiveMessages, archiveFiles, archiveFilename, safeArchiveName } = await import(await source('../src/features/archiveRules.ts'))
const { swipeClaim, swipeOffset } = await import(await source('../src/utils/swipeReply.ts'))
const play = (engine, data) => engine.play(engine.turn, engine.nextSeq, data)

test('pagination keeps the signature with three final body lines and preserves every line', () => {
  for (let length = 0; length < 160; length++) {
    const lines = Array(length).fill(28), metrics = { header: 92, lines, signature: 56 }
    const pages = planLetterPages(metrics, 714)
    assert.deepEqual(pages.flatMap((p) => Array.from({ length: p.to - p.from }, (_, i) => p.from + i)), Array.from({ length }, (_, i) => i))
    assert.equal(pages.filter((p) => p.signature).length, 1)
    const last = pages.at(-1)
    assert.equal(last.signature, true)
    assert(last.to - last.from >= Math.min(3, length))
    for (const [i, page] of pages.entries()) assert((i === 0 ? metrics.header : 0) + (page.to - page.from) * 28 + (page.signature ? 74 : 0) <= 714)
  }
})

test('near-one-page letters step down; long letters keep 20pt', () => {
  const measure = (size) => ({ header: (size + 8) * 2 + 36, lines: Array(size === 20 ? 20 : 18).fill(size + 8), signature: (size + 8) * 2 })
  const near = chooseLetterSize(700, measure)
  assert.equal(near.size, 18); assert.equal(near.pages.length, 1)
  assert.equal(chooseLetterSize(714, (size) => ({ header: 90, lines: Array(70).fill(size + 8), signature: 2 * (size + 8) })).size, 20)
})

test('zip naming is safe, unique ignoring case, and excludes tombstoned media before file collection', () => {
  const msg = (id, type, payload, deletedAt = null) => ({ id, type, payload, deletedAt, createdAt: '2026-10-20T12:00:00Z' })
  const messages = [msg('a','letter',{ to: '../A/B' }), msg('b','letter',{ to: '../A/B' }), msg('c','image',{ mime:'image/webp',width:512,height:512,path:'chat/c' }), msg('d','voice',{ mime:'audio/mp4',path:'chat/d' }), msg('e','file',{ mime:'text/plain',name:'../../Letter.TXT',path:'chat/e' }), msg('f','file',{ mime:'text/plain',name:'../../letter.txt',path:'chat/f' }), msg('g','image',{ mime:'image/png',path:'chat/deleted' },'now'), msg('h','system',null)]
  const kept = archiveMessages(messages), files = archiveFiles(messages)
  assert.equal(kept.length, 6); assert.equal(files.length, 6)
  assert(files[0].name.startsWith('letters/2026-10-20-')); assert(files[1].name.endsWith('(2).pdf'))
  assert(files[2].name.startsWith('images/stickers/')); assert(files[3].name.startsWith('voice/'))
  assert(files[5].name.endsWith('(2).txt'))
  assert(!files.some((f) => f.message.id === 'g'))
  assert(files.every((f) => !f.name.split('/').includes('..')))
  assert.equal(safeArchiveName('...'), 'file')
  assert.equal(safeArchiveName('CON.txt'), '_CON.txt')
  assert.match(archiveFilename('../Arfah/', '2026-10-20T12:00:00Z'), /^one-on-one-[^/\\]+-2026-10-20\.zip$/)
})

test('swipes claim only strongly horizontal movement toward the reply direction', () => {
  assert.equal(swipeClaim(9,1,false), 'wait')
  assert.equal(swipeClaim(80,0,false,true), 'scroll')
  for (const [dx,dy,mine] of [[60,30,false],[60,31,false],[60,0,true],[-60,0,false],[0,40,true]]) assert.equal(swipeClaim(dx,dy,mine), 'scroll')
  assert.equal(swipeClaim(61,30,false),'reply'); assert.equal(swipeClaim(-61,30,true),'reply')
  assert.equal(swipeOffset(60,false),60); assert.equal(swipeOffset(-60,true),-60)
  assert.equal(swipeOffset(100,false),70); assert.equal(swipeOffset(-200,true),-80)
})

test('tic-tac-toe Android fixtures cover win, draw and invalid/duplicate/out-of-turn moves', () => {
  const game = new TicTacToeGame()
  for (const [player,seq,data] of [[2,0,{cell:0}],[1,1,{cell:0}],[1,0,{cell:'0'}],[1,0,{cell:0,extra:true}],[1,0,{cell:-1}]]) assert.throws(() => game.play(player,seq,data))
  assert.equal(game.nextSeq,0)
  for (const cell of [0,3,1,4,2]) play(game,{cell})
  assert.deepEqual(game.result,{winner:1,detail:'Three in a row'}); assert.deepEqual(game.winning,[0,1,2])
  assert.throws(() => play(game,{cell:8}))
  const draw = new TicTacToeGame(); for (const cell of [0,1,2,4,3,5,7,6,8]) play(draw,{cell})
  assert.equal(draw.result.winner,0)
  const occupied = new TicTacToeGame(); play(occupied,{cell:0}); assert.throws(() => play(occupied,{cell:0})); assert.equal(occupied.nextSeq,1)
})

test('Connect 4 Android fixtures cover every win direction, draw and illegal columns', () => {
  for (const moves of [[0,1,0,1,0,1,0],[0,6,1,6,2,5,3],[0,1,1,2,4,2,2,3,4,3,5,3,3]]) {
    const g=new ConnectFourGame(); for (const col of moves) play(g,{col}); assert.equal(g.result.winner,1)
  }
  const g=new ConnectFourGame(); for(let i=0;i<6;i++) play(g,{col:0})
  for(const col of [0,7,-1,1.5,'1']) assert.throws(()=>play(g,{col}))
  assert.equal(g.nextSeq,6)
  const draw=new ConnectFourGame(); for (const col of [3,5,3,2,4,6,5,4,0,1,2,4,1,4,6,2,4,5,3,5,2,0,4,0,0,1,2,6,5,3,0,0,2,1,1,5,1,3,6,6,6,3]) play(draw,{col})
  assert.equal(draw.result.winner,0)
})

test('5×5 Dots & Boxes retains turn for one/two completed boxes and ends at 60 edges', () => {
  const g=new DotsGame()
  for(const data of [{h:true,r:0,c:0},{h:true,r:1,c:0},{h:true,r:0,c:1},{h:true,r:1,c:1},{h:false,r:0,c:0},{h:false,r:0,c:2}]) play(g,data)
  play(g,{h:false,r:0,c:1}); assert.equal(g.score(1),2); assert.equal(g.turn,1)
  assert.throws(()=>play(g,{h:false,r:0,c:1})); assert.throws(()=>play(g,{h:false,r:5,c:0})); assert.equal(g.nextSeq,7)
  const full=new DotsGame(); for(const h of [true,false]) for(let i=0;i<30;i++) play(full,{h,r:Math.floor(i/(h?5:6)),c:i%(h?5:6)})
  assert.equal(full.nextSeq,60); assert.equal(full.score(1)+full.score(2),25); assert(full.result)
})

test('chess Android fixtures cover legal UCI, special moves, mate and all draw rules', () => {
  const g=new ChessGame(); assert.equal(g.legal.length,20)
  for(const uci of ['a1a8','c1h6','e2e5','e2e4q']) assert.throws(()=>play(g,{uci}))
  assert.throws(()=>g.play(2,0,{uci:'e2e4'})); play(g,{uci:'e2e4'}); assert.throws(()=>g.play(2,0,{uci:'e7e5'})); assert.equal(g.nextSeq,1)
  const mate=new ChessGame(); for(const uci of ['f2f3','e7e5','g2g4','d8h4']) play(mate,{uci}); assert.equal(mate.result.detail,'Checkmate')
  assert.equal(new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').result.detail,'Stalemate')
  assert.equal(new ChessGame('7k/8/6K1/8/8/8/8/8 w - - 0 1').result.detail,'Insufficient material')
  const fifty=new ChessGame('7k/8/6K1/8/8/8/8/R7 w - - 99 60'); play(fifty,{uci:'a1b1'}); assert.equal(fifty.result.detail,'Draw by the 50-move rule')
  const rep=new ChessGame(); for(let i=0;i<2;i++) for(const uci of ['g1f3','g8f6','f3g1','f6g8']) play(rep,{uci}); assert.equal(rep.result.detail,'Draw by repetition')
  const castle=new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); play(castle,{uci:'e1g1'}); assert.equal(castle.board.get('f1').type,'r')
  const ep=new ChessGame(); for(const uci of ['e2e4','a7a6','e4e5','d7d5','e5d6']) play(ep,{uci}); assert.equal(ep.board.get('d5'),undefined); assert.deepEqual(ep.captured,['p'])
  for(const piece of 'qrbn') { const promotion=new ChessGame('7k/P7/8/8/8/8/8/7K w - - 0 1'); play(promotion,{uci:`a7a8${piece}`}); assert.equal(promotion.board.get('a8').type,piece) }
})

test('Pong Android envelopes use independent sequences, Float32 boundaries and monotonic scores', () => {
  const host=new PongGame(), guest=new PongGame()
  host.paddle(1,.105); const first=host.packet(true); assert.deepEqual(Object.keys(first).sort(),['b','p','s'])
  guest.receive(1,0,first); host.receive(2,0,{p:.5})
  assert.throws(()=>guest.receive(1,0,first)); assert.throws(()=>host.receive(2,2,{p:.5}))
  for(const data of [{p:NaN},{p:0},{p:'0.5'},{p:.5,b:[]}]) assert.throws(()=>host.receive(2,1,data))
  assert.throws(()=>guest.receive(1,1,{p:.5,b:[.5,.5,0,0],s:[2,0]}))
  guest.receive(1,1,{p:.5,b:[.5,.5,0,0],s:[1,0]})
  assert.throws(()=>guest.receive(1,2,{p:.5,b:[.5,.5,0,0],s:[0,0]}))
  for(let i=2;i<=7;i++) guest.receive(1,i,{p:.5,b:[.5,.5,0,0],s:[i,0]})
  assert.equal(guest.winner,1)
  for(let i=0;i<61;i++) host.tick(.05,true)
  assert(host.vx>0); host.tick(.05,true); assert(host.x>.5)
})

test('session invites, converges simultaneous invites, rejects stale/foreign events and clears timers', async () => {
  const sent=[], notices=[]; const s=new GameSession(async(e,p)=>sent.push([e,p]),'Alex',()=>{},(n)=>notices.push(n))
  s.hub(); assert.equal(s.stage,'idle'); assert.equal(notices[0],'Games need Alex online')
  s.availability(true,'other'); s.hub(); s.invite('tictactoe'); const id=s.id
  s.receive({name:'game:accept',gameId:id,from:'stranger'}); assert.equal(s.stage,'outgoing')
  s.receive({name:'game:accept',gameId:id,from:'other'}); assert.equal(s.stage,'playing')
  s.move({cell:0}); await Promise.resolve(); await Promise.resolve()
  s.receive({name:'game:move',gameId:id,from:'other',seq:1,data:{cell:3}}); assert.equal(s.board.nextSeq,2)
  s.receive({name:'game:move',gameId:id,from:'other',seq:1,data:{cell:4}}); assert.equal(s.stage,'result'); assert.match(s.result.detail,/out-of-sequence/)
  s.receive({name:'game:accept',gameId:id,from:'other'}); assert.equal(s.stage,'result')
  s.done(); s.invite('dots'); s.receive({name:'game:invite',gameId:'0',game:'chess',from:'other'}); assert.equal(s.stage,'incoming'); assert.equal(s.kind,'chess')
  s.accept(); assert.equal(s.player,2); assert.equal(s.stage,'playing')
  s.availability(false); assert.equal(s.paused,true); s.availability(true); assert.equal(s.paused,false)
  s.dispose(); assert(sent.some(([e,p])=>e==='game:end'&&p.reason==='invalid_move'))
})

test('session invitation expiry and disconnect deadlines follow Android 30s/15s without retrying moves', async (t) => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']})
  const s=new GameSession(async()=>{},'Alex',()=>{},()=>{}); s.availability(true,'other'); s.invite('tictactoe')
  t.mock.timers.tick(30_000); assert.equal(s.stage,'result'); assert.match(s.result.detail,/expired/)
  s.done(); s.invite('tictactoe'); s.receive({name:'game:accept',gameId:s.id,from:'other'}); s.availability(false)
  t.mock.timers.tick(14_999); assert.equal(s.stage,'playing'); t.mock.timers.tick(1); assert.equal(s.stage,'result'); assert.match(s.result.detail,/disconnected/)
  s.dispose()
})
