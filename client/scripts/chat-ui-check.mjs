// Local render fixtures only: no accounts, sockets, or backend writes.
// Start Vite, then: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/chat-ui-check.mjs [before|after]
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const stage = process.argv[2] ?? 'after'
const out = resolve('../docs/ui-whatsapp', stage)
await mkdir(out, { recursive: true })
const now = new Date(); now.setHours(12, 0, 0, 0)
const at = (seconds) => new Date(+now + seconds * 1000).toISOString()
const message = (id, senderId, content, seconds, type = 'text', payload = null, replyTo = null) => ({ id, senderId, content, createdAt: at(seconds), type, payload, replyTo, reactions: [] })
const history = [
  message('old', 'peer', 'A little reminder from last week', -7 * 86400),
  message('yesterday', 'me', 'See you tomorrow', -86400),
  message('hello', 'peer', 'Hey, how was your day?', 0),
  message('group', 'peer', 'Coffee later? ☕', 25),
  message('long', 'me', 'Yes! A long message should wrap naturally and keep the time tucked into the last line. '+ 'Looking forward to seeing you. '.repeat(5), 100),
  message('emoji', 'peer', '💚 😊', 180),
  message('reply', 'me', 'That sounds lovely', 260, 'text', null, 'hello'),
  message('letter', 'peer', 'Thank you for being here.', 340, 'letter', {to:'Alex',from:'Sam',appearance:'dawn'}),
  message('countdown', 'me', 'Our weekend', 420, 'countdown', {label:'Our weekend',targetIso:at(86400 * 3)}),
  message('checkin', 'peer', 'Feeling good today', 500, 'checkin', {mood:'good',note:'Feeling good today'}),
  message('ask', 'me', 'What made you smile?', 580, 'ask', {question:'What made you smile?',answerA:'Your message'}),
  message('ask-reveal', 'peer', 'What made you smile?', 660, 'ask', {question:'What made you smile?',answerA:'Your message',answerB:'Our plans'}, 'ask'),
  message('choice', 'peer', 'Tea vs coffee', 740, 'thisorthat', {optionA:'Tea',optionB:'Coffee',pickSender:'a'}),
  message('choice-reveal', 'me', 'Tea vs coffee', 820, 'thisorthat', {optionA:'Tea',optionB:'Coffee',pickSender:'a',pickRecipient:'b'}, 'choice'),
  message('alarm', 'peer', '', -3600, 'alarm', {}),
  message('alarm-ack', 'me', '', -3500, 'alarm', {ack:'alarm'}, 'alarm'),
  message('location', 'peer', '', 900, 'location', {lat:12.9716,lng:77.5946}),
  message('voice', 'me', '', 980, 'voice', {path:'voice.webm',duration:21,size:1500,mime:'audio/webm'}),
  message('image', 'peer', 'A quiet evening', 1060, 'image', {path:'photo.jpg',url:'/love.jpg',width:600,height:400}),
  message('file', 'me', '', 1140, 'file', {path:'plans.pdf',name:'Weekend plans.pdf',size:2048,mime:'application/pdf'}),
  message('last', 'me', 'See you soon 💚', 1220),
]
history.find(m=>m.id==='reply').reactions = [{emoji:'❤️',userIds:['peer']}]
const current = {id:'fixture',status:'active',myUserId:'me',otherNickname:'Sam',otherConnectionCode:'test',myLeaveStep:0,otherLeaveStep:0,otherLastReadAt:at(1200),otherLastDeliveredAt:at(1400),wallpaper:'off',messageStyle:'line'}
const browser = await chromium.launch({headless:true, channel:process.env.CHROME_CHANNEL || undefined})
try {
  const page = await browser.newPage({viewport:{width:360,height:800}})
  const errors = []; page.on('pageerror', e=>errors.push(e.message))
  // Replace service modules only in this browser, never in the repository.
  await page.route('**/src/services/apiClient.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const setUnauthorizedHandler=()=>{}; export async function authedFetch(path) { let value=path.endsWith('/current') ? {connection:window.fixture.current} : path.includes('/messages') ? {messages:window.fixture.history} : path.endsWith('/signed') ? {urls:{'voice.webm':'/fixture.wav','plans.pdf':'/fixture.pdf'}} : {}; return new Response(JSON.stringify(value),{status:200}); }`}))
  await page.route('**/src/services/authService.ts*', async route=>{
    const source = await readFile(resolve('src/services/authService.ts'),'utf8')
    const names=[...source.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1])
    await route.fulfill({contentType:'application/javascript',body:names.map(n=>`export const ${n}=async()=>null;`).join('\n')})
  })
  await page.route('**/src/services/messageService.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getCallTransport=()=>({onIncoming:()=>()=>{}}); export async function connectMessaging(){let onMessage; const t={getState:()=>window.fixture.state,onMessage:fn=>(window.fixture.incoming=fn,()=>{}),onReaction:fn=>(window.fixture.reaction=fn,()=>{}),onConnectionEnded:()=>()=>{},onStateChange:fn=>(window.fixture.changeState=fn,()=>{}),onReceipt:()=>()=>{},disconnect:()=>{},sendReaction:async()=>{},sendMessage:async(content,type,payload,replyTo,tempId)=>({id:tempId,senderId:'me',content,type,payload,replyTo,createdAt:new Date().toISOString()})};return t;}`}))
  await page.route('**/src/features/alarmNative.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getNativeAlarmState=async()=>({ringing:false}); export const isAlarmSilenced=()=>true; export const maybePromptFullScreenIntent=async()=>{}; export const setNativeChatActive=async()=>{}; export const stopNativeAlarm=async()=>{}; export const markAlarmSilenced=()=>{};`}))
  await page.route('**/src/features/pushNotifications.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getNotificationsLabel=async()=>'Notifications: On'; export const isPushSubscribed=async()=>true; export const isPushSupported=()=>true; export const subscribeToPush=async()=>{}; export const unsubscribeFromPush=async()=>{}; export const clearPushOnSignOut=async()=>{}; export const initNativePush=async()=>{};`}))
  await page.route('**/src/features/call/controller.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export function mountCallBar(nav){for(const id of ['video-btn','call-btn']){let b=nav.querySelector('#'+id);if(!b){b=document.createElement('button');b.className='chat__call-btn';b.textContent=id==='video-btn'?'▣':'☎';nav.querySelector('#menu-btn').before(b);}b.disabled=false;}return {dispose(){},startVideoCall(){},startAudioCall(){}}}`}))
  await page.route('**/tile.openstreetmap.org/**', route=>route.abort())
  await page.route('**/fixture.wav', route=>route.fulfill({contentType:'audio/wav',body:Buffer.alloc(44)}))
  // Empty entry document; import the real ChatPage and real CSS from Vite.
  await page.route('http://127.0.0.1:5173/', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}))
  await page.goto('http://127.0.0.1:5173/')
  await page.evaluate(async ({history,current})=>{
    window.fixture={history,current,state:'connecting'}
    await import('/src/styles/global.css')
    const {ChatPage}=await import('/src/pages/ChatPage.ts')
    window.fixture.mount=()=>window.fixture.cleanup=ChatPage(document.querySelector('#app'), screen=>window.fixture.navigation=screen)
    window.fixture.mount()
  },{history,current})
  await page.waitForSelector('[data-id="last"]')
  await page.waitForFunction(()=>!!window.fixture.changeState)
  for (const [width,height] of [[360,800],[412,915]]) {
    await page.setViewportSize({width,height})
    for (const theme of ['dark','light']) for (const wallpaper of ['off','love','samurai']) {
      await page.evaluate(({theme,wallpaper})=>{
        const chat=document.querySelector('.chat');chat.dataset.theme=theme
        chat.classList.toggle('chat--wallpaper-love',wallpaper==='love');chat.classList.toggle('chat--wallpaper-samurai',wallpaper==='samurai')
        document.querySelector('[data-id="hello"]').scrollIntoView({block:'start'})
      },{theme,wallpaper})
      await page.waitForTimeout(200)
      await page.screenshot({path:resolve(out,`${width}-${theme}-${wallpaper}.png`)})
      if(stage==='after') {
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'document overflow')
        assert.equal(await page.evaluate(()=>{const log=document.querySelector('#chat-log');return log.scrollWidth>log.clientWidth}),false,'log overflow')
      }
    }
  }
  if(stage==='after') {
    assert.equal(await page.locator('.chat__message-time,.chat__message-sender').count(),0)
    assert.equal(await page.locator('.chat--bubbles').count(),1,'legacy line normalized')
    assert.equal(await page.locator('[data-id="group"]').getAttribute('data-group-start'),'0')
    for(const id of ['menu-btn','video-btn','call-btn','attach-btn','mic-btn']) {
      const box=await page.locator('#'+id).boundingBox();assert.ok(box.width>=40&&box.height>=40,id+' target')
    }
    await page.locator('#menu-btn').click()
    await page.locator('summary').filter({hasText:'Connection & account'}).click()
    assert.ok(await page.locator('[data-action="block"]').isVisible())
    await page.locator('summary').filter({hasText:'About'}).click()
    assert.ok(await page.locator('[data-action="privacy"]').isVisible())
    await page.screenshot({path:resolve(out,'menu.png')})
    await page.locator('[data-action="search"]').click()
    await page.locator('#search-input').fill('lovely')
    await page.waitForTimeout(180);assert.ok(await page.locator('mark').count())
    await page.screenshot({path:resolve(out,'search.png')})
    await page.locator('#search-close').click()
    for(const state of ['connecting','offline','connected']) {
      await page.evaluate(state=>window.fixture.changeState(state,false),state)
      await page.screenshot({path:resolve(out,`header-${state}.png`)})
    }
    for(const id of ['letter','countdown','checkin','ask','ask-reveal','choice','choice-reveal','alarm','location','voice','image','file']) {
      await page.locator(`[data-id="${id}"]`).scrollIntoViewIfNeeded()
      await page.screenshot({path:resolve(out,`card-${id}.png`)})
    }
    await page.locator('[data-id="reply"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    await page.locator('[data-id="reply"]').click({button:'right'})
    await page.waitForTimeout(220)
    await page.screenshot({path:resolve(out,'context-menu.png')})
    await page.locator('.chat__ctx-menu .menu__item').filter({hasText:/^Reply$/}).click()
    await page.waitForTimeout(200)
    assert.ok(await page.locator('.chat__reply-bar--visible').count())
    await page.screenshot({path:resolve(out,'reply.png')})
    await page.setViewportSize({width:412,height:550}) // viewport shrink, not a real Android keyboard
    await page.screenshot({path:resolve(out,'keyboard-viewport.png')})
    await page.setViewportSize({width:412,height:915})
  }
  assert.deepEqual(errors,[],'browser exceptions')
  console.log(await page.evaluate(()=>['body','.chat__message-text','.chat__input-bar textarea'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return [selector,s.fontFamily,s.fontSize,s.backgroundColor]})))
  console.log(`${stage}: fixture render matrix passed; screenshots: ${out}`)
} finally { await browser.close() }
