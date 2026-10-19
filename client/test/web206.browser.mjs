// Real client + scripted Socket.IO relay; disposable users, no deployed writes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import JSZip from 'jszip'
const { Server } = createRequire(new URL('../../backend/package.json', import.meta.url))('socket.io')
const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const screenshots = fileURLToPath(new URL('../../docs/ui-web-2.0.6/', import.meta.url))
await mkdir(screenshots, { recursive: true })
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let connection, messages, gates, calls, signed, moves, mediaDelay
const reset = () => {
  connection = { id:'fixture-chat', status:'active', myUserId:'me', isRequester:true, otherNickname:'Alex', otherConnectionCode:'ABCDEFGH', otherLastReadAt:new Date().toISOString(), otherLastDeliveredAt:new Date().toISOString(), wallpaper:'off', messageStyle:'bubbles', pinnedMessageId:null, pinnedBy:null, pinnedAt:null, myAvatarId:null, otherAvatarId:null }
  const msg = (n,type,content,payload=null,extra={}) => ({id:id(n),senderId:'other',type,content,payload,replyTo:null,createdAt:new Date(Date.now()-(100-n)*1000).toISOString(),reactions:[],deletedAt:null,editedAt:null,...extra})
  messages=Array.from({length:52},(_,i)=>msg(i+1,'text',`Earlier ${i+1}`))
  messages.push(msg(53,'letter','A promise for tomorrow. नमस्ते 🌷',{appearance:'dawn',to:'Sam',from:'Alex'}))
  messages.push(msg(54,'text','React together',null,{reactions:[{emoji:'❤️',userIds:['me']},{emoji:'👍',userIds:['other']}]}))
  messages.push(msg(55,'thisorthat','Tea vs Coffee',{optionA:'Tea',optionB:'Coffee',pickSender:'a',pickRecipient:'a'}))
  messages.push(msg(56,'file','A note',{path:'fixture-chat/note.txt',mime:'text/plain',name:'../../note.txt',size:4}))
  messages.push(msg(57,'image','',{path:'fixture-chat/deleted.png',mime:'image/png',width:4,height:4,size:4},{deletedAt:new Date().toISOString()}))
  messages.push(msg(58,'ask','A question',{question:'How was your day?',answerA:'Good'}))
  messages.push(msg(59,'image','',{path:'fixture-chat/sticker.webp',mime:'image/webp',width:512,height:512,size:20}))
  messages.push(msg(60,'voice','',{path:'fixture-chat/voice.m4a',mime:'audio/mp4',duration:1,size:4}))
  gates=new Map(['me','other'].map((u)=>[u,{ageVerifiedAt:'2026-10-19T12:00:00Z',termsAcceptedAt:'2026-10-19T12:00:00Z'}]))
  calls=[];signed=[];moves=[];mediaDelay=0
}
reset()
const api=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,PATCH,OPTIONS')
  if(req.method==='OPTIONS'){res.writeHead(204).end();return}
  const url=new URL(req.url,'http://fixture'),user=(req.headers.authorization||'Bearer me').slice(7)
  const body=async()=>{let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{}}
  const json=(value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
  calls.push([req.method,url.pathname,user])
  if(url.pathname==='/api/me')json({userId:user,connectionCode:'ABCDEFGH',...gates.get(user)})
  else if(url.pathname==='/api/me/gates'){const input=await body(),value=gates.get(user)||{ageVerifiedAt:null,termsAcceptedAt:null};if(input.ageVerified)value.ageVerifiedAt||=new Date().toISOString();if(input.termsAccepted)value.termsAcceptedAt||=new Date().toISOString();gates.set(user,value);json(value)}
  else if(url.pathname==='/api/connections/current')json({connection:!connection||connection.endedBy===user?null:{...connection,myUserId:user,otherNickname:user==='me'?connection.otherNickname:'Sam'}})
  else if(url.pathname==='/api/me/avatars')json({mine:null,other:null})
  else if(url.pathname==='/api/me/blocks')json({blocks:[]})
  else if(url.pathname.endsWith('/messages')){const before=url.searchParams.get('before'),after=url.searchParams.get('after'),list=messages.filter((m)=>(!before||m.createdAt<before)&&(!after||m.createdAt>after));json({messages:after?list.slice(0,50):list.slice(-50)})}
  else if(url.pathname.endsWith('/attachments/signed')){const{paths}=await body();signed.push(...paths);json({urls:Object.fromEntries(paths.map((p)=>[p,`${apiOrigin}/media?path=${encodeURIComponent(p)}`]))})}
  else if(url.pathname==='/media'){if(mediaDelay)await new Promise((r)=>setTimeout(r,mediaDelay));if(url.searchParams.get('path').endsWith('.webp')){res.setHeader('Content-Type','image/webp');res.end(await readFile(new URL('../public/stickers/packs/Shapes/01_circle.webp',import.meta.url)))}else{res.setHeader('Content-Type','application/octet-stream');res.end('note')}}
  else if(url.pathname.endsWith('/leave')){connection={...connection,status:'ended',endedBy:user,endedAt:new Date().toISOString(),purgeAt:new Date(Date.now()+7*86400000).toISOString()};io.emit('connection:ended');json({leave:{terminated:true,status:'ended'}})}
  else if(url.pathname.endsWith('/acknowledge-end')){connection=null;res.writeHead(204).end()}
  else if(url.pathname.endsWith('/read')||url.pathname.endsWith('/delivered'))res.writeHead(204).end()
  else{res.writeHead(404);json({error:`Fixture route missing: ${url.pathname}`})}
})
const io=new Server(api,{cors:{origin:'*'}})
io.on('connection',(socket)=>{
  const user=socket.handshake.auth.token,peer=user==='me'?'other':'me';socket.join(user)
  socket.on('presence',()=>socket.emit('presence',{userId:peer,online:true,lastSeenAt:null}))
  socket.on('message:read',(_data,ack)=>{calls.push(['socket','message:read',user]);io.to(peer).emit('receipt:update',{userId:user,lastReadAt:new Date().toISOString()});ack({ok:true})})
  for(const event of ['game:invite','game:accept','game:decline','game:move','game:end'])socket.on(event,(packet,ack)=>{moves.push([event,packet,user]);io.to(peer).emit(event,{...packet,from:user});ack({ok:true})})
  socket.on('message:send',(data,ack)=>{const m={id:id(1000+messages.length),senderId:user,createdAt:new Date().toISOString(),type:data.type||'text',content:data.content,payload:data.payload,replyTo:data.replyTo,reactions:[],tempId:data.tempId};messages.push(m);io.emit('message:new',m);ack({ok:true,message:m})})
})
await new Promise((r)=>api.listen(0,'127.0.0.1',r))
const apiOrigin=`http://127.0.0.1:${api.address().port}`
const vite=await createViteServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,define:{'import.meta.env.VITE_API_URL':JSON.stringify(apiOrigin)},plugins:[{name:'fixture-auth',enforce:'pre',transformIndexHtml(html){return html.replace("connect-src 'self'",`connect-src 'self' ${apiOrigin} ${apiOrigin.replace('http:','ws:')}`)},transform(code,path){if(path.replaceAll('\\','/').endsWith('/src/services/supabaseClient.ts'))return `const uid=new URLSearchParams(location.search).get('user')||'me';export const supabase={auth:{getSession:async()=>({data:{session:{access_token:uid,user:{id:uid}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}}`;if(code.includes('import.meta.env.VITE_API_URL'))return code.replaceAll('import.meta.env.VITE_API_URL',JSON.stringify(apiOrigin))}}],server:{host:'127.0.0.1',port:0,hmr:false}})
await vite.listen()
const origin=`http://127.0.0.1:${vite.httpServer.address().port}`
const browser=await playwright.chromium.launch(process.env.PARITY_CHANNEL?{channel:process.env.PARITY_CHANNEL}:{})
const contexts=[]
const wait=(page,text)=>page.waitForFunction((text)=>document.body.textContent.includes(text),text)
const command=async(page,name)=>{await page.locator('#message-input').fill(`/${name}`);await page.locator('#send-btn').click()}
const go=(page,screen)=>page.evaluate(async(screen)=>(await import('/src/state/router.ts')).navigateToScreen(screen),screen)
try{
  for(const width of [1280,360]){
    reset()
    const context=await browser.newContext({viewport:{width,height:850},hasTouch:width===360,isMobile:width===360,serviceWorkers:'block',colorScheme:'dark'});contexts.push(context)
    const errors=[]
    await context.addInitScript(()=>{localStorage.setItem('notificationReminderAt',String(Date.now()));window.__utterances=[];Object.defineProperty(window,'speechSynthesis',{value:{speak:(u)=>window.__utterances.push(u.text),cancel:()=>{window.__stopped=true}}});window.SpeechRecognition=class{start(){window.__recognition=this}stop(){this.onend?.()}abort(){this.onend?.()}}})
    await context.route('**/*',(route)=>route.request().url().startsWith(origin)||route.request().url().startsWith(apiOrigin)?route.continue():route.abort())
    const page=await context.newPage(),other=await context.newPage()
    for(const p of [page,other]){p.setDefaultTimeout(12_000);p.on('pageerror',(err)=>errors.push(err.message))}
    await page.goto(origin+'?user=me');await page.locator('#message-input').waitFor();await page.locator('#splash').waitFor({state:'hidden'})
    assert.equal(await page.locator('#dob-day').count(),0,'server gates skip in a new browser')
    gates.set('me',{ageVerifiedAt:null,termsAcceptedAt:null})
    await page.evaluate(()=>{localStorage.setItem('ageVerified:me','1');localStorage.setItem('termsAcceptedAt:me','2026-10-19T12:00:00Z')})
    await page.reload();await page.locator('#message-input').waitFor()
    const migrations=calls.filter(([method,path,user])=>method==='POST'&&path==='/api/me/gates'&&user==='me').length
    assert.equal(migrations,1,'local gates migrate once')
    await page.reload();await page.locator('#message-input').waitFor()
    assert.equal(calls.filter(([method,path,user])=>method==='POST'&&path==='/api/me/gates'&&user==='me').length,migrations)
    assert(calls.some(([kind,name])=>kind==='socket'&&name==='message:read'))
    assert.equal(await page.locator('.chat__reaction-total').textContent(),'2')
    assert.equal(await page.locator('.thisorthat-card__option').count(),2);assert.equal(await page.locator('.thisorthat-card__pick').count(),2);await wait(page,'You matched!')
    if(width===1280){
      connection.otherNickname='Alex & Bea <b>friend</b>';await page.reload();await page.locator('#message-input').waitFor()
      assert.equal(await page.locator('.thisorthat-card__pick').count(),2)
      assert((await page.locator('.thisorthat-card__pick').allTextContents()).includes(connection.otherNickname))
      assert.equal(await page.locator('.thisorthat-card__picks b').count(),0)
      connection.otherNickname='Alex';await page.reload();await page.locator('#message-input').waitFor()
    }
    await page.waitForFunction(async()=>{try{return !!(await import('/src/services/messageService.ts')).getCallTransport()}catch{return false}})
    const sealed={id:id(70),senderId:'other',type:'thisorthat',content:'Rain vs Sun',payload:{optionA:'Rain',optionB:'Sun',pickSender:'a'},replyTo:null,createdAt:new Date().toISOString(),reactions:[]}
    messages.push(sealed);io.emit('message:new',sealed)
    await page.locator(`[data-id="${id(70)}"]`).getByRole('button',{name:'Rain',exact:true}).click()
    await page.waitForFunction(()=>[...document.querySelectorAll('.thisorthat-card--revealed')].length===2)
    assert(messages.some((m)=>m.replyTo===id(70)&&m.payload?.pickRecipient==='a'),'received tile reveals with one tap')
    for(const theme of ['dark','light']){await page.evaluate((theme)=>document.querySelector('.chat').dataset.theme=theme,theme);await page.screenshot({path:join(screenshots,`${width}-${theme}-chat.png`)})}
    await page.locator(`[data-id="${id(53)}"] .letter-card`).click();await page.locator('.letter-sheet').waitFor()
    await page.getByRole('button',{name:'Read letter aloud',exact:true}).click();assert.match((await page.evaluate(()=>window.__utterances))[0],/^Dear Sam\. A promise/)
    await page.getByRole('button',{name:'Stop reading',exact:true}).click();assert(await page.evaluate(()=>window.__stopped));await page.screenshot({path:join(screenshots,`${width}-letter.png`)});await page.keyboard.press('Escape')
    await command(page,'audio');await page.locator('.voice-typing').waitFor();await page.locator('#message-input').fill('Draft')
    await page.evaluate(()=>window.__recognition.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'partial words'}}]}));await wait(page,'partial words')
    const count=messages.length
    await page.evaluate(()=>{window.__recognition.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'spoken text'}}]});window.__recognition.onend()})
    assert.equal(await page.locator('#message-input').inputValue(),'Draft spoken text');assert.equal(messages.length,count)
    await command(page,'audio');await page.locator('.voice-typing').waitFor()
    await page.evaluate(()=>{window.__lateResult=window.__recognition.onresult})
    await page.getByRole('button',{name:'Cancel',exact:true}).click()
    await page.evaluate(()=>window.__lateResult({resultIndex:0,results:[{isFinal:true,0:{transcript:'late words'}}]}))
    assert.equal(await page.locator('#message-input').inputValue(),'','cancel ignores late dictated text')
    await page.evaluate(()=>{delete window.SpeechRecognition;delete window.webkitSpeechRecognition});await command(page,'audio');await wait(page,"Voice typing isn't supported in this browser")
    await command(page,'thisorthat');await page.locator('#thisorthat-a').fill('Beach');await page.locator('#thisorthat-b').fill('Mountains');await page.getByRole('button',{name:'Mountains',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Mountains',exact:true}).getAttribute('aria-pressed'),'true');await page.screenshot({path:join(screenshots,`${width}-choice-composer.png`)});await page.keyboard.press('Escape')
    await other.goto(origin+'?user=other');await other.locator('#message-input').waitFor()
    await page.bringToFront();await command(page,'games');await page.getByRole('button',{name:'Tic-Tac-Toe',exact:true}).click();await other.getByRole('button',{name:'Accept',exact:true}).click();await wait(page,'Your turn')
    const equalRows=async(p)=>{const heights=await p.locator('.game-board > button').evaluateAll((buttons)=>buttons.map((b)=>b.getBoundingClientRect().height));assert(Math.max(...heights)-Math.min(...heights)<1,'board squares keep equal row heights')}
    await equalRows(page)
    for(const[p,key]of[[page,'0'],[other,'3'],[page,'1'],[other,'4'],[page,'2']]){await p.locator(`.game-board [data-key="${key}"][aria-disabled="false"]`).waitFor();await p.locator(`.game-board [data-key="${key}"]`).click()}
    await wait(page,'You won');await wait(other,'Sam won');assert.deepEqual(moves.filter(([e])=>e==='game:move').map(([,p])=>[p.seq,p.data]),[[0,{cell:0}],[1,{cell:3}],[2,{cell:1}],[3,{cell:4}],[4,{cell:2}]])
    await page.screenshot({path:join(screenshots,`${width}-tictactoe-result.png`)})
    await page.getByRole('button',{name:'Rematch',exact:true}).click();await other.getByRole('button',{name:'Decline',exact:true}).click();await wait(page,'declined');await page.getByRole('button',{name:'Done',exact:true}).click()
    for(const title of ['Chess','Connect 4','Dots & Boxes','Table Tennis']){
      await page.bringToFront();await command(page,'games');await page.getByRole('button',{name:title,exact:true}).click();await other.getByRole('button',{name:'Accept',exact:true}).click();await page.locator('.game-surface:not([hidden])').waitFor()
      if(title==='Chess'){await page.getByRole('button',{name:/^e2, white pawn/}).click();await page.getByRole('button',{name:/^e4, empty, legal destination/}).click()}
      if(title==='Chess')await equalRows(page)
      if(title==='Connect 4')await page.locator('.game-board [data-key="0"]').click()
      if(title==='Dots & Boxes')await page.getByRole('button',{name:'Horizontal line, row 1, column 1, empty',exact:true}).click()
      if(title==='Table Tennis'){await page.locator('.game-paddle').fill('0.605');await page.waitForTimeout(150);assert(moves.some(([e,p])=>e==='game:move'&&p.data?.b?.length===4))}
      assert(await page.locator('.game-surface').evaluate((el)=>el.scrollWidth<=el.clientWidth))
      await page.screenshot({path:join(screenshots,`${width}-${title.replaceAll(/[^a-z0-9]/gi,'-')}.png`)})
      await page.getByRole('button',{name:'Resign',exact:true}).click();await page.getByRole('button',{name:'Resign',exact:true}).last().click();await wait(page,'You resigned.');await other.getByRole('button',{name:'Done',exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();await other.getByRole('button',{name:'Done',exact:true}).click()
    }
    await page.bringToFront();io.to('me').emit('presence',{userId:'other',online:false,lastSeenAt:new Date().toISOString()});await wait(page,'Last seen');await command(page,'games');await wait(page,'Games need Alex online');assert.equal(await page.locator('.game-hub').count(),0)
    await go(page,'leave');await wait(page,'Leave connection?');assert.equal(await page.getByRole('button',{name:'Save a copy first',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Leave without saving',exact:true}).count(),1);await page.screenshot({path:join(screenshots,`${width}-leave.png`)});await page.getByRole('button',{name:'Cancel',exact:true}).click();assert(!calls.some(([,p])=>p.endsWith('/leave')))
    await go(page,'export');await page.getByRole('button',{name:'Save zip with photos and files',exact:true}).waitFor()
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save zip with photos and files',exact:true}).click();const file=await download,dir=await mkdtemp(join(tmpdir(),'web206-')),archivePath=join(dir,file.suggestedFilename());await file.saveAs(archivePath);assert.match(file.suggestedFilename(),/^one-on-one-Alex-\d{4}-\d{2}-\d{2}\.zip$/)
    const zip=await JSZip.loadAsync(await readFile(archivePath)),entries=Object.keys(zip.files)
    for(const name of ['conversation.html','conversation.txt'])assert(entries.includes(name))
    for(const[folder,ext]of[['letters/','.pdf'],['files/','.txt'],['images/stickers/','.webp'],['voice/','.m4a']])assert(entries.some((p)=>p.startsWith(folder)&&p.endsWith(ext)))
    assert((await zip.file('conversation.txt').async('string')).includes('Earlier 1'));assert(!signed.includes('fixture-chat/deleted.png'));console.log(`ZIP verified ${width}px: ${archivePath}`)
    await page.getByRole('button',{name:'Back',exact:true}).click();await go(page,'leave');await page.getByRole('button',{name:'Save a copy first',exact:true}).waitFor()
    mediaDelay=2000;await page.getByRole('button',{name:'Save a copy first',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).last().click();mediaDelay=0;assert(!calls.some(([,p])=>p.endsWith('/leave')))
    await page.getByRole('button',{name:'Leave without saving',exact:true}).click();await wait(other,'Sam left the connection.');assert.equal(await other.locator('#message-input').count(),0)
    await other.reload();await wait(other,'Sam left the connection.')
    await other.screenshot({path:join(screenshots,`${width}-partner-left.png`)})
    if(width===1280){await other.getByRole('button',{name:'Skip',exact:true}).click();await other.getByRole('button',{name:'Delete',exact:true}).click()}
    else{const endedDownload=other.waitForEvent('download');await other.getByRole('button',{name:'Save zip',exact:true}).click();await endedDownload}
    await other.waitForFunction(()=>!document.querySelector('[data-save]'))
    assert(calls.some(([,p])=>p.endsWith('/acknowledge-end')));assert(!calls.some(([,p])=>/leave\/(cancel|confirm-end)/.test(p)));assert.deepEqual(errors,[])
    await context.close();console.log(`PASS web 2.0.6 ${width}px: gates, speech, cards, receipts, five game UIs, two-page full tic-tac-toe, zip, leave and partner-left`)
  }
}catch(error){
  for(const context of contexts)for(const[i,page]of context.pages().entries())if(!page.isClosed()){await page.screenshot({path:join(screenshots,`failure-${i}.png`)}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-1800))}
  throw error
}finally{await browser.close();await vite.close();await new Promise((r)=>io.close(r));api.closeAllConnections();await new Promise((r)=>api.close(r))}
