// Local render fixtures only: no accounts, sockets, or backend writes.
// Start Vite, then: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/chat-ui-check.mjs [before|after]
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const stage = process.argv[2] ?? 'after'
const base = process.env.UI_URL ?? 'http://127.0.0.1:5173'
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
for(let i=0;i<30;i++) history.push(message('history-'+i,'peer','Earlier conversation '+i,-2*86400+i*120))
const current = {id:'fixture',status:'active',myUserId:'me',otherNickname:'Sam',otherConnectionCode:'test',myLeaveStep:0,otherLeaveStep:0,otherLastReadAt:at(1200),otherLastDeliveredAt:at(1400),wallpaper:'off',messageStyle:'line'}
const browser = await chromium.launch({headless:true, channel:process.env.CHROME_CHANNEL || undefined})
try {
  const page = await browser.newPage({viewport:{width:360,height:800}})
  await page.addInitScript(()=>{
    window.qa={heightReads:0,fragments:0,intervals:new Set(),observers:new Set(),scrolls:[]}
    const height=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight')
    Object.defineProperty(Element.prototype,'scrollHeight',{...height,get(){if(this.id==='chat-log')window.qa.heightReads++;return height.get.call(this)}})
    const append=Node.prototype.appendChild
    Node.prototype.appendChild=function(node){if(this.id==='chat-log'&&node instanceof DocumentFragment)window.qa.fragments++;return append.call(this,node)}
    const scroll=Element.prototype.scrollTo
    Element.prototype.scrollTo=function(...args){if(this.id==='chat-log')window.qa.scrolls.push(args[0]);return scroll.apply(this,args)}
    const set=window.setInterval,clear=window.clearInterval
    window.setInterval=(...args)=>{const id=set(...args);window.qa.intervals.add(id);return id}
    window.clearInterval=id=>{window.qa.intervals.delete(id);clear(id)}
    const Observer=window.IntersectionObserver
    window.IntersectionObserver=class extends Observer {constructor(...args){super(...args);window.qa.observers.add(this)}disconnect(){window.qa.observers.delete(this);super.disconnect()}}
  })
  const errors = []; page.on('pageerror', e=>errors.push(e.message))
  // Replace service modules only in this browser, never in the repository.
  await page.route('**/src/services/apiClient.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const setUnauthorizedHandler=()=>{}; export async function authedFetch(path) { let value=path.endsWith('/current') ? {connection:window.fixture.current} : path.includes('/messages?before=') ? {messages:window.fixture.older??[]} : path.includes('/messages?after=') ? {messages:window.fixture.resync??[]} : path.includes('/messages') ? {messages:window.fixture.history} : path.endsWith('/signed') ? {urls:{'voice.webm':'/fixture.wav','plans.pdf':'/fixture.pdf'}} : {}; return new Response(JSON.stringify(value),{status:200}); }`}))
  await page.route('**/src/services/authService.ts*', async route=>{
    const source = await readFile(resolve('src/services/authService.ts'),'utf8')
    const names=[...source.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1])
    await route.fulfill({contentType:'application/javascript',body:names.map(n=>`export const ${n}=async()=>null;`).join('\n')})
  })
  await page.route('**/src/services/messageService.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getCallTransport=()=>({onIncoming:()=>()=>{},onEnded:()=>()=>{}}); export async function connectMessaging(){const t={getState:()=>window.fixture.state,onMessage:fn=>(window.fixture.incoming=fn,()=>{}),onReaction:fn=>(window.fixture.reaction=fn,()=>{}),onConnectionEnded:()=>()=>{},onStateChange:fn=>(window.fixture.changeState=fn,()=>{}),onReceipt:()=>()=>{},disconnect:()=>{},sendReaction:async()=>{},sendMessage:async(content,type,payload,replyTo,tempId)=>({id:tempId,senderId:'me',content,type,payload,replyTo,createdAt:new Date().toISOString()})};return t;}`}))
  await page.route('**/src/features/alarmNative.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getNativeAlarmState=async()=>({ringing:false}); export const isAlarmSilenced=()=>true; export const maybePromptFullScreenIntent=async()=>{}; export const setNativeChatActive=async()=>{}; export const stopNativeAlarm=async()=>{}; export const markAlarmSilenced=()=>{};`}))
  await page.route('**/src/features/pushNotifications.ts*', route=>route.fulfill({contentType:'application/javascript',body:`export const getNotificationsLabel=async()=>'Notifications: On'; export const isPushSubscribed=async()=>true; export const isPushSupported=()=>true; export const subscribeToPush=async()=>{}; export const unsubscribeFromPush=async()=>{}; export const clearPushOnSignOut=async()=>{}; export const initNativePush=async()=>{};`}))
  await page.route('**/tile.openstreetmap.org/**', route=>route.abort())
  await page.route('**/fixture.wav', route=>route.fulfill({contentType:'audio/wav',body:Buffer.alloc(44)}))
  // Empty entry document; import the real ChatPage and real CSS from Vite.
  await page.route(`${base}/`, route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}))
  await page.goto(`${base}/`)
  const main = await readFile(resolve('src/main.ts'),'utf8')
  const viewportCode = stage==='after' ? main.slice(main.indexOf('let viewportFrame = 0'),main.indexOf('// Last-resort visibility')).replaceAll(': void','') : ''
  await page.evaluate(async ({history,current,viewportCode})=>{
    window.fixture={history,current,state:'connecting'}
    if(viewportCode) new Function(viewportCode)()
    await import('/src/styles/global.css')
    const {ChatPage}=await import('/src/pages/ChatPage.ts')
    window.fixture.mount=()=>window.fixture.cleanup=ChatPage(document.querySelector('#app'), screen=>window.fixture.navigation=screen)
    window.fixture.mount()
  },{history,current,viewportCode})
  await page.waitForSelector('[data-id="last"]')
  await page.waitForFunction(()=>!!window.fixture.changeState)
  if(stage==='after') {
    assert.equal(await page.evaluate(()=>window.qa.fragments),1,'history appended once as fragment')
    assert.ok(await page.evaluate(()=>window.qa.heightReads<=3),'no per-row history layout reads')
  }
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
        const ratio=await page.evaluate(()=>{
          const s=getComputedStyle(document.querySelector('[data-id="long"] .chat__message-body'))
          const lum=value=>{const c=value.match(/\d+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
          const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
        });assert.ok(ratio>=4.5,`${theme} outgoing contrast ${ratio}`)
        for(const id of ['reply','letter','countdown','checkin','ask','ask-reveal','choice','choice-reveal','alarm','location','voice','image','file']) {
          await page.locator(`[data-id="${id}"]`).scrollIntoViewIfNeeded()
          assert.ok(await page.locator(`[data-id="${id}"] .chat__message-body`).evaluate(el=>el.scrollWidth<=el.clientWidth+7),`${width}/${theme}/${wallpaper}/${id} content overflow (excluding 6px tail)`)
        }
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
      assert.equal(await page.locator('#call-btn').isDisabled(),state!=='connected')
      assert.equal(await page.locator('#video-btn').count(),1,'header controls reused')
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
    await page.locator('#reply-bar-cancel').click()
    const viewportWrites=await page.evaluate(async()=>{
      let writes=0;const style=document.documentElement.style;const set=style.setProperty.bind(style)
      style.setProperty=(key,...args)=>{if(key.startsWith('--app-'))writes++;return set(key,...args)}
      for(let i=0;i<8;i++){visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'))}
      await new Promise(requestAnimationFrame);style.setProperty=set;return writes
    });assert.equal(viewportWrites,0,'unchanged viewport writes skipped')
    // Swipe batches transforms in rAF, caches rects, restores transitions on cancel.
    const swipe=await page.evaluate(async()=>{
      const row=document.querySelector('[data-id="reply"]');const log=document.querySelector('#chat-log')
      let reads=0;const rect=row.getBoundingClientRect.bind(row);row.getBoundingClientRect=()=>{reads++;return rect()}
      const touch=(type,x)=>row.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchcancel'?[]:[new Touch({identifier:1,target:row,clientX:x,clientY:200})]}))
      touch('touchstart',30);touch('touchmove',70);touch('touchmove',105)
      const during=row.style.transition
      await new Promise(requestAnimationFrame);const transform=row.style.transform
      touch('touchcancel',105)
      return {reads,during,transform,after:row.style.transition,icons:log.querySelectorAll('.chat__swipe-icon').length}
    })
    assert.deepEqual(swipe,{reads:1,during:'none',transform:'translateX(75px)',after:'',icons:0})
    // Map indexing survives ordered inserts and optimistic ID reconciliation.
    await page.evaluate(m=>window.fixture.incoming(m),message('inserted','peer','Inserted between grouped messages',15))
    assert.equal(await page.locator('[data-id="inserted"]').evaluate(el=>el.nextElementSibling.dataset.id),'group')
    await page.evaluate(()=>{const log=document.querySelector('#chat-log');log.scrollTop=0})
    const scrollsBeforeSend=await page.evaluate(()=>window.qa.scrolls.length)
    await page.locator('#message-input').fill('A new send')
    await page.locator('#send-btn').click()
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(()=>window.qa.scrolls.length),scrollsBeforeSend,'own send while reading history does not scroll')
    const savedId=await page.locator('.chat__message').filter({hasText:'A new send'}).getAttribute('data-id')
    assert.ok(savedId,'optimistic row got server id')
    await page.evaluate(id=>window.fixture.reaction({messageId:id,emoji:'❤️',userId:'peer',op:'add'}),savedId)
    assert.equal(await page.locator(`[data-id="${savedId}"] .chat__reaction-chip`).count(),1)
    // Quotes use the same index, including ack-assigned IDs.
    await page.evaluate(m=>window.fixture.incoming(m),message('saved-quote','peer','Reply to your send',1400,'text',null,savedId))
    await page.locator('[data-id="saved-quote"] .chat__quote').click()
    assert.ok(await page.locator(`[data-id="${savedId}"].chat__message--flash`).count())
    await page.evaluate(()=>{const log=document.querySelector('#chat-log');log.scrollTop=log.scrollHeight;const input=document.querySelector('#message-input');input.value='Near-bottom send';input.dispatchEvent(new Event('input'));document.querySelector('#composer').requestSubmit()})
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(()=>window.qa.scrolls.at(-1).behavior),'smooth','near-bottom own send scrolls smoothly')
    await page.evaluate(older=>{window.fixture.older=older},[message('older-different-day','peer','A previous day',-8*86400)])
    await page.locator('.chat__load-older').click()
    await page.waitForSelector('[data-id="older-different-day"]')
    assert.equal(await page.locator('[data-id="old"]').evaluate(el=>el.previousElementSibling.className),'chat__date-separator','keep distinct day separator')
    assert.equal(await page.locator('.chat__enc-note').evaluate(el=>el.parentElement.firstElementChild===el),true,'encryption chip stays at top after pagination')
    const intervals=await page.evaluate(()=>window.qa.intervals.size)
    await page.locator('[data-id="countdown"]').evaluate(el=>{window.fixture.detached=el;el.remove()})
    await page.waitForTimeout(30)
    assert.equal(await page.evaluate(()=>window.qa.intervals.size),intervals-1,'removed countdown cleared immediately')
    await page.evaluate(()=>window.fixture.reaction({messageId:'countdown',emoji:'❤️',userId:'peer',op:'add'}))
    assert.equal(await page.evaluate(()=>window.fixture.detached.querySelector('.chat__reaction-badge')),null,'removed row evicted from index')
    await page.evaluate(()=>{window.fixture.resync=[{id:'resynced',senderId:'peer',type:'text',content:'Recovered message',createdAt:new Date(Date.now()+1000).toISOString(),replyTo:'hello',payload:null}];window.fixture.changeState('connected',true)})
    await page.waitForSelector('[data-id="resynced"]')
    await page.evaluate(()=>window.fixture.reaction({messageId:'resynced',emoji:'❤️',userId:'peer',op:'add'}))
    assert.equal(await page.locator('[data-id="resynced"] .chat__reaction-chip').count(),1,'resynced row indexed')
    await page.evaluate(()=>window.fixture.cleanup())
    assert.equal(await page.evaluate(()=>window.qa.intervals.size),0,'unmount intervals')
    assert.equal(await page.evaluate(()=>window.qa.observers.size),0,'unmount location observers')
    await page.evaluate(()=>window.fixture.mount())
    await page.waitForSelector('[data-id="last"]')
    assert.equal(await page.locator('.chat').evaluate(el=>getComputedStyle(el).animationName),'none','return has no screen fade')
    await page.evaluate(()=>window.fixture.cleanup())
  }
  assert.deepEqual(errors,[],'browser exceptions')
  console.log(`${stage}: fixture render matrix passed; screenshots: ${out}`)
} finally { await browser.close() }
