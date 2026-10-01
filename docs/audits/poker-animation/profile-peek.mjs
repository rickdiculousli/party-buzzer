import { chromium } from '/Users/rickli/repos/party-buzzer/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:390,height:844}})
page.on('pageerror',e=>console.error(e.message))
await page.goto('http://127.0.0.1:5173/anim.html');await page.waitForTimeout(500)
await page.evaluate(async()=>{
 const {h,render}=await import('/@fs/Users/rickli/repos/party-buzzer/node_modules/.vite/deps/preact.js?v=2a152833')
 const {PokerPlayer}=await import('/PokerPlayer.tsx')
 render(null,document.body);document.body.innerHTML='<div id="sweep-root"></div>'
 const players=[{id:'p0',name:'Ada',connected:true},{id:'p1',name:'Bo',connected:true}]
 const state={players,teams:[],games:[],minigame:{id:'poker',matchId:'sweep',phase:'playing',options:{shotSec:30},participants:players.map(p=>p.id)}}
 const frame={id:'poker',role:'player',matchId:'sweep',serverTime:Date.now(),tick:1,phase:'betting',street:'preflop',seats:players.map((p,i)=>({player:p.id,stack:1000,bet:0,button:i===1,sb:i===0,bb:i===1,folded:false,allIn:false,busted:false,place:null,away:false,cards:null})),board:[],pots:[100],actor:'p1',actBy:Date.now()+30000,handNo:1,sb:25,bb:50,nextLevelAt:Date.now()+60000,equity:null,runout:false,showdown:null,feed:[],reactions:[],hole:['Ah','Kd'],legal:null,canShow:false,place:null}
 render(h(PokerPlayer,{state,playerId:'p0',frame,now:()=>Date.now(),send:()=>{},ack:null}),document.querySelector('#sweep-root'))
 window.reads={}
 for(const key of ['offsetWidth','offsetHeight','offsetLeft','offsetTop']){
  const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,key)
  Object.defineProperty(HTMLElement.prototype,key,{...d,get(){window.reads[key]=(window.reads[key]??0)+1;return d.get.call(this)}})
 }
 const old=Element.prototype.getBoundingClientRect
 Element.prototype.getBoundingClientRect=function(){window.reads.rect=(window.reads.rect??0)+1;return old.call(this)}
 window.writes=0
 new MutationObserver(list=>window.writes+=list.length).observe(document.querySelector('#sweep-root'),{attributes:true,attributeFilter:['style'],subtree:true})
})
await page.waitForTimeout(500)
const cdp=await page.context().newCDPSession(page)
const results=[]
async function trace(label,action){
 const events=[];const collect=({value})=>events.push(...value)
 cdp.on('Tracing.dataCollected',collect)
 await page.evaluate(()=>{window.reads={};window.writes=0})
 await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'})
 await action()
 const end=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await end;cdp.off('Tracing.dataCollected',collect)
 const result={label,...await page.evaluate(()=>({reads:window.reads,writes:window.writes}))}
 for(const name of ['Paint','UpdateLayoutTree','Layout','FireAnimationFrame']){const es=events.filter(e=>e.name===name&&e.ph==='X');result[name]={count:es.length,ms:+(es.reduce((s,e)=>s+(e.dur??0),0)/1000).toFixed(2)}}
 results.push(result)
}
await trace('idle phone, 2 seconds',()=>page.waitForTimeout(2000))
const box=await page.locator('.poker-peek-line').boundingBox()
await page.mouse.move(box.x+box.width*.65,box.y+30);await page.mouse.down();await page.waitForTimeout(220)
await page.mouse.move(box.x+box.width*.65,box.y-60,{steps:6});await page.waitForTimeout(300)
await trace('moving peek, 1 second',async()=>{for(let i=0;i<30;i++){await page.mouse.move(box.x+box.width*.65+Math.sin(i/5)*20,box.y-60+Math.sin(i/5)*20);await page.waitForTimeout(16)}})
await trace('stationary raised peek, 2 seconds',()=>page.waitForTimeout(2000))
await trace('release peek',async()=>{await page.mouse.up();await page.waitForTimeout(500)})
await page.screenshot({path:'/tmp/poker-peek-sweep.png'})
await writeFile('/tmp/poker-peek-sweep.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2));await browser.close()
