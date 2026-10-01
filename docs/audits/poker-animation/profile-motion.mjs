import { chromium } from '/Users/rickli/repos/party-buzzer/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({headless:true})
const page = await browser.newPage({viewport:{width:1920,height:1080}})
page.on('pageerror', e => console.error(e.message))
await page.goto('http://127.0.0.1:5173/anim.html')
await page.waitForTimeout(1500)
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
const results=[]
for (const label of ['Deal','Flop','Showdown','Chip stacks under the centre lamp','The pot: a corral of stacks']) {
  const button=page.locator('.harness__scenarios button').filter({hasText:new RegExp(`^${label}$`)})
  if (!await button.count()) {console.log('missing',label);continue}
  await button.click()
  await page.waitForTimeout(2500)
  for(const fixed of [false,true]) {
    await page.evaluate(fixed=>{
      document.querySelector('#sweep-light')?.remove()
      if(fixed){const s=document.createElement('style');s.id='sweep-light';s.textContent='.poker-card { --piece-x: 288 !important; --piece-y: 230 !important; --piece-rot: 0 !important; --piece-lift: 0 !important; --side: 0 !important; } .poker-stack { --piece-x: 288 !important; --piece-y: 230 !important; }';document.head.append(s)}
    },fixed)
    const events=[]
    const collect=({value})=>events.push(...value)
    cdp.on('Tracing.dataCollected',collect)
    await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'})
    for(let take=0;take<2;take++){await page.getByRole('button',{name:'Retrigger',exact:true}).click();await page.waitForTimeout(2500)}
    const end=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve))
    await cdp.send('Tracing.end');await end;cdp.off('Tracing.dataCollected',collect)
    const row={label,fixed}
    for(const name of ['Paint','UpdateLayoutTree','Layout','PrePaint']){const es=events.filter(e=>e.name===name && e.ph==='X');row[name]={count:es.length,ms:+(es.reduce((s,e)=>s+(e.dur??0),0)/1000).toFixed(2)}}
    results.push(row)
  }
}
await page.evaluate(()=>document.querySelector('#sweep-light')?.remove())
await writeFile('/tmp/poker-animation-sweep-scenarios.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2))
await page.evaluate(async()=>{
  const {h,render,options}=await import('/@fs/Users/rickli/repos/party-buzzer/node_modules/.vite/deps/preact.js?v=2a152833')
  const {PokerBoard}=await import('/PokerBoard.tsx')
  render(null,document.body);document.body.innerHTML='<div id="sweep-root"></div>'
  const root=document.querySelector('#sweep-root')
  const players=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Player ${i}`,connected:true}))
  const state={players,teams:[],games:[],minigame:{id:'poker',matchId:'sweep',phase:'playing',options:{shotSec:30},participants:players.map(p=>p.id)}}
  const base={id:'poker',role:'board',matchId:'sweep',serverTime:Date.now(),tick:1,phase:'betting',street:'preflop',seats:players.map((p,i)=>({player:p.id,stack:1000,bet:i<2?50:0,button:i===7,sb:i===0,bb:i===1,folded:false,allIn:false,busted:false,place:null,away:false,cards:null})),board:[],pots:[300],actor:'p2',actBy:Date.now()+30000,handNo:1,sb:25,bb:50,nextLevelAt:Date.now()+60000,equity:null,runout:false,showdown:null,feed:[],reactions:[]}
  window.sweep={render:()=>render(h(PokerBoard,{state,frame:JSON.parse(JSON.stringify(base)),now:()=>Date.now()}),root),base,counts:{},ms:0}
  const old=options.__r
  options.__r=v=>{const name=v.type?.name;if(name)window.sweep.counts[name]=(window.sweep.counts[name]??0)+1;old?.(v)}
  window.sweep.render()
})
await page.waitForTimeout(1000)
for(const dealt of [false,true]) {
  await page.evaluate(dealt=>{window.sweep.base.handNo=dealt?2:1;window.sweep.counts={};window.sweep.ms=0},dealt)
  const before=await cdp.send('Performance.getMetrics')
  await page.evaluate(async()=>{for(let i=0;i<180;i++){const t=performance.now();window.sweep.render();window.sweep.ms+=performance.now()-t;await new Promise(r=>setTimeout(r,16))}})
  const after=await cdp.send('Performance.getMetrics')
  const metric=n=>after.metrics.find(m=>m.name===n).value-before.metrics.find(m=>m.name===n).value
  results.push({label:dealt?'board after new deal':'board reload',counts:await page.evaluate(()=>window.sweep.counts),renderMs:await page.evaluate(()=>window.sweep.ms),scriptMs:metric('ScriptDuration')*1000,styleMs:metric('RecalcStyleDuration')*1000,layoutMs:metric('LayoutDuration')*1000})
}
await writeFile('/tmp/poker-animation-sweep.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2))
await browser.close()
