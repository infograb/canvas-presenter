import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {findBrowserExecutable} from '../../scripts/browser-bin.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=process.argv[2];
const output=process.argv[3];
const demoDir=process.argv[4];
if(!base||!output||!demoDir)throw new Error('Usage: node assets/runtime/browser-qa.mjs BASE_URL QA_OUTPUT_DIR DEMO_DIR');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:await findBrowserExecutable()});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2,reducedMotion:'reduce'});
const page=await context.newPage();
const failures=[],external=[],errors=[],results=[];
page.on('request',request=>{if(!/^(http:\/\/127\.0\.0\.1:|file:|data:|about:|blob:)/.test(request.url()))external.push(request.url());});
page.on('pageerror',error=>errors.push(error.message));
const attr=name=>page.locator('.app').getAttribute(name);
const idle=async()=>{await page.waitForFunction(()=>document.documentElement.dataset.canvasReady==='true');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(220);};
const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:false});
const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){failures.push({name,error:e.message});results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);}};
// Playwright는 iframe 좌표를 부모로 옮길 때 iframe에 걸린 CSS transform을 무시한다.
// 캔버스 카드와 슬라이드 쇼는 둘 다 iframe을 scale로 줄이므로, 배율을 직접 계산해 부모 좌표로 누른다.
const clickInsideScaledFrame=async(frameSelector,frameLocator,label)=>{
 // 카메라 전환이 끝나기 전에 좌표를 재면 클릭이 빗나간다. 상자가 멈출 때까지 기다린다.
 let box=await page.locator(frameSelector).boundingBox();
 for(let attempt=0;attempt<40;attempt++){
  await page.waitForTimeout(80);
  const next=await page.locator(frameSelector).boundingBox();
  if(next&&box&&Math.abs(next.x-box.x)<0.5&&Math.abs(next.y-box.y)<0.5&&Math.abs(next.width-box.width)<0.5){box=next;break;}
  box=next;
 }
 if(!box)throw new Error(`${label}: iframe has no box`);
 const inner=await frameLocator.locator('button',{hasText:label}).first().evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,docWidth:document.documentElement.clientWidth};});
 const scale=box.width/inner.docWidth;
 await page.mouse.click(box.x+inner.x*scale,box.y+inner.y*scale);
};
try {
 for(const mode of ['grouped','tree','sequence']){
  await check(`${mode}: initial overview and all mixed media`,async()=>{
   const start=Date.now();await page.goto(`${base}/${mode}/`);await idle();
   assert.equal(await attr('data-focused'),'overview');
   assert.equal(await attr('data-step'),'-1');
   assert.equal(await page.locator('.slide-card').count(),6);
   assert.equal(await page.locator('iframe').count(),0);
   assert.equal(await page.locator('.react-flow__minimap').count(),1);
   assert.equal(await page.getByRole('link',{name:/React Flow/i}).count(),0);
   const broken=await page.locator('.slide-content img').evaluateAll(images=>images.filter(i=>!i.complete||!i.naturalWidth).length);
   assert.equal(broken,0);
   const payload=JSON.parse(await page.locator('#canvas-data').textContent());
   assert.equal(payload.counts.slides,6);
   assert.equal(payload.counts.html,1);assert.equal(payload.counts.svg,4);assert.equal(payload.counts.png,1);
   if(mode==='tree')assert.ok(payload.edges.length>=2);
   if(mode==='sequence')assert.equal(payload.counts.groups,0);
   await shot(`${mode}-overview-1920x1080-2x`);
   results.push({name:`${mode}: load`,milliseconds:Date.now()-start});
  });
 }
 await page.goto(`${base}/grouped/`);await idle();
 const payload=JSON.parse(await page.locator('#canvas-data').textContent());
 await check('ordered navigation preserves exact path targets',async()=>{
  const main=payload.paths.find(p=>p.id===payload.defaultPath);
  for(let i=0;i<main.steps.length;i++){
   await page.getByRole('button',{name:'다음 슬라이드',exact:true}).click();
   assert.equal(await attr('data-step'),String(i));assert.equal(await attr('data-focused'),main.steps[i].target);
  }
  assert.ok(await page.getByRole('button',{name:'다음 슬라이드',exact:true}).isDisabled());
  await page.getByRole('button',{name:'이전 슬라이드',exact:true}).click();assert.equal(await attr('data-step'),String(main.steps.length-2));
 });
 await check('detour and return preserve narrative cursor',async()=>{
  const cursor=await attr('data-step');
  await page.getByRole('button',{name:'목차 슬라이드: 그룹 레이아웃',exact:true}).click();
  assert.equal(await attr('data-focused'),'s04');assert.equal(await attr('data-step'),cursor);
  await page.getByRole('button',{name:'발표 경로 복귀',exact:true}).click();assert.equal(await attr('data-focused'),payload.paths[0].steps[Number(cursor)].target);
 });
 await check('group focus and parent return',async()=>{
  await page.getByRole('button',{name:'목차 슬라이드: 상호작용 장면',exact:true}).click();
  await page.getByRole('button',{name:'상위 그룹으로 이동 (U)',exact:true}).click();assert.equal(await attr('data-focused'),'paths');
  const card=await page.locator('.react-flow__node[data-id="paths"]').boundingBox();const stage=await page.locator('.stage').boundingBox();
  assert.ok(card.x>=stage.x-2&&card.y>=stage.y-2&&card.x+card.width<=stage.x+stage.width+2&&card.y+card.height<=stage.y+stage.height+2);
  await shot('group-focus-1920x1080-2x');
 });
 await check('HTML pointer activation and single iframe budget',async()=>{
  await page.getByRole('button',{name:'목차 슬라이드: 상호작용 장면',exact:true}).click();
  assert.equal(await page.locator('iframe').count(),1);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
  await page.getByRole('button',{name:'HTML 직접 조작',exact:true}).click();
  await page.waitForTimeout(120);
  const frame=page.frameLocator('iframe');
  await clickInsideScaledFrame('iframe',frame,'질문 중심 보기');
  await frame.getByText('궁금한 장면부터 살펴봅니다',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'전체 구조 보기',exact:true}).count(),1);
  const slide=await page.locator('iframe').boundingBox(),mini=await page.locator('.react-flow__minimap').boundingBox();
  assert.ok(slide.y+slide.height<=mini.y+2,'minimap must not obscure the slide');
  await shot('html-interaction-1920x1080-2x');
  await page.getByRole('button',{name:'HTML 조작 종료',exact:true}).click();
  await page.getByRole('button',{name:'목차 슬라이드: 사용자 자료',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);
 });
 await check('slide-only fullscreen slideshow, HTML interaction and Escape bridge',async()=>{
  await page.goto(`${base}/grouped/`);await idle();
  await page.getByRole('button',{name:'전체 화면 슬라이드 쇼 시작 (S)',exact:true}).click();
  assert.equal(await attr('data-slideshow'),'true');
  assert.equal(await attr('data-step'),'0');
  assert.equal(await attr('data-focused'),'s01');
  assert.equal(await page.locator('.slideshow').getAttribute('aria-modal'),'true');
  assert.equal(await page.locator('.app-header').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('.slideshow iframe').count(),0);
  await page.keyboard.press('ArrowRight');assert.equal(await attr('data-step'),'1');
  await page.keyboard.press('End');assert.equal(await attr('data-step'),'5');
  assert.equal(await page.locator('iframe').count(),1);
  assert.equal(await page.locator('.slideshow iframe').count(),1);
  const frame=page.frameLocator('.slideshow iframe');
  await page.keyboard.press('KeyC');
  assert.equal(await page.locator('.annotation-surface.passthrough').count(),1,'direct manipulation lifts the annotation surface');
  await clickInsideScaledFrame('.slideshow iframe',frame,'질문 중심 보기');
  await frame.getByText('궁금한 장면부터 살펴봅니다',{exact:true}).waitFor();
  await page.keyboard.press('KeyC');
  await page.waitForFunction(()=>document.querySelectorAll('.annotation-surface.passthrough').length===0);
  await shot('slideshow-html-1920x1080-2x');
  await frame.getByRole('button',{name:'전체 구조 보기',exact:true}).focus();
  await frame.getByRole('button',{name:'전체 구조 보기',exact:true}).press('ArrowLeft');
  await page.waitForFunction(()=>document.querySelector('.app')?.dataset.step==='4');
  assert.equal(await page.locator('.slideshow iframe').count(),0);
  await page.keyboard.press('End');
  const exitFrame=page.frameLocator('.slideshow iframe');
  await exitFrame.getByRole('button').focus();
  await exitFrame.getByRole('button').press('Escape');
  await page.waitForFunction(()=>document.querySelector('.app')?.dataset.slideshow==='false');
  assert.equal(await page.locator('.slideshow').count(),0);
  assert.equal(await page.locator('.notice').count(),0);
  assert.equal(await page.locator('[data-slideshow-toggle]').evaluate(el=>document.activeElement===el),true);
 });
 await check('alternate path, keyboard navigation and URL restore',async()=>{
  await page.getByRole('combobox',{name:'발표 경로 선택'}).selectOption('question-first');
  assert.equal(await attr('data-step'),'-1');assert.equal(await attr('data-focused'),'overview');
  await page.getByRole('button',{name:'다음 슬라이드',exact:true}).click();assert.equal(await attr('data-focused'),'s06');
  await page.keyboard.press('ArrowRight');assert.equal(await attr('data-focused'),'s04');
  await page.keyboard.press('KeyK');assert.equal(await attr('data-focused'),'s06');
  await page.keyboard.press('Space');assert.equal(await attr('data-focused'),'s04');
  await page.keyboard.press('Shift+Space');assert.equal(await attr('data-focused'),'s06');
  await page.keyboard.press('End');assert.equal(await attr('data-focused'),'s01');
  await page.keyboard.press('0');assert.equal(await attr('data-focused'),'overview');assert.equal(await attr('data-step'),'3');
  await page.keyboard.press('KeyR');assert.equal(await attr('data-focused'),'s01');
  const saved=page.url();await page.reload();await idle();assert.equal(page.url(),saved);assert.equal(await attr('data-focused'),'s01');
 });
 await check('minimap click changes viewport without consuming a path step',async()=>{
  const before=await page.locator('.react-flow__viewport').getAttribute('style'),cursor=await attr('data-step');
  await page.locator('.react-flow__minimap-node').last().click();await page.waitForTimeout(220);
  assert.notEqual(await page.locator('.react-flow__viewport').getAttribute('style'),before);assert.equal(await attr('data-step'),cursor);
 });
 await check('slideshow annotation: laser follows, idles out, box draws and clears',async()=>{
  await page.goto(`${base}/grouped/`);await idle();
  await page.getByRole('button',{name:'전체 화면 슬라이드 쇼 시작 (S)',exact:true}).click();
  const stage=await page.locator('.slideshow-stage').boundingBox();
  const cx=Math.round(stage.x+stage.width/2),cy=Math.round(stage.y+stage.height/2);
  await page.mouse.move(cx-80,cy);await page.mouse.move(cx-50,cy+12);
  await page.locator('.laser-dot.show').waitFor();
  assert.equal(await page.locator('.annotation-surface.laser-active').count(),1,'laser hides the system cursor');
  await page.waitForFunction(()=>!document.querySelector('.laser-dot')?.classList.contains('show'),null,{timeout:4000});
  await page.mouse.move(cx-220,cy-110);await page.mouse.down();await page.mouse.move(cx+140,cy+90,{steps:8});await page.mouse.up();
  await page.locator('.draw-box.show').waitFor();
  await shot('slideshow-annotation-1920x1080-2x');
  await page.mouse.move(cx+260,cy+160);await page.mouse.down();await page.mouse.up();
  assert.equal(await page.locator('.draw-box.show').count(),0,'a click without drag clears the box');
  await page.mouse.move(cx-220,cy-110);await page.mouse.down();await page.mouse.move(cx+140,cy+90,{steps:8});await page.mouse.up();
  await page.locator('.draw-box.show').waitFor();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.draw-box.show').count(),0,'changing slide clears the box');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.app')?.dataset.slideshow==='false');
 });
 await check('header composition, fullscreen and notes',async()=>{
  await page.waitForFunction(()=>{const labels=[...document.querySelectorAll('.header-actions button')].map(b=>b.textContent);
   return labels.length===5&&labels[0]==='목차 숨기기'&&labels[1]==='전체화면'&&labels[2]==='슬라이드 쇼'&&labels[4]==='단축키';});
  assert.equal(await page.locator('[data-theme-toggle]').count(),1,'the theme toggle sits between the slideshow and the shortcut button');
  await page.getByRole('button',{name:'전체화면 전환 (F)',exact:true}).click();
  // 전체화면은 허용될 수도 거부될 수도 있다. 어느 쪽이든 관측될 때까지 기다린 뒤 그 결과로 분기한다.
  await page.waitForFunction(()=>document.querySelector('[aria-label="전체화면 전환 (F)"]')?.getAttribute('aria-pressed')==='true'||document.body.innerText.includes('전체화면 요청을 허용하지 않았습니다'));
  if(await page.getByRole('button',{name:'전체화면 전환 (F)'}).getAttribute('aria-pressed')==='true'){
   await page.getByRole('button',{name:'전체화면 전환 (F)',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[aria-label="전체화면 전환 (F)"]')?.getAttribute('aria-pressed')!=='true');
  }
  await page.getByRole('button',{name:'노트',exact:true}).click();assert.equal(await page.locator('.notes-panel').count(),1);
  await page.getByRole('button',{name:'노트 닫기',exact:true}).click();
 });
 await check('theme follows the system, can be overridden, and keeps slide colors',async()=>{
  const read=async()=>page.evaluate(()=>{
   const root=document.documentElement,style=getComputedStyle(root),mm=document.querySelector('.react-flow__minimap');
   return{
    mode:root.dataset.theme??'auto',
    label:document.querySelector('[data-theme-toggle]').textContent,
    surface:style.getPropertyValue('--surface').trim(),
    header:getComputedStyle(document.querySelector('.app-header')).backgroundColor,
    mask:mm.getAttribute('style').match(/mask-background-color-props: ([^;]+)/)[1].trim(),
    slide:getComputedStyle(document.querySelector('.slide-card')).backgroundColor,
   };
  });
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  const auto=await read();
  assert.equal(auto.mode,'auto');
  assert.equal(auto.surface,'#0E1A20','auto must follow the system preference');
  await page.getByRole('button',{name:/화면 모드/}).click();
  const forcedLight=await read();
  assert.equal(forcedLight.mode,'light','an explicit choice overrides the system preference');
  assert.equal(forcedLight.surface,'#F7FAF8');
  await page.keyboard.press('KeyA');
  const forcedDark=await read();
  assert.equal(forcedDark.mode,'dark');
  assert.notEqual(forcedDark.mask,forcedLight.mask,'the minimap mask must follow the theme');
  assert.notEqual(forcedDark.header,forcedLight.header);
  assert.equal(forcedDark.slide,forcedLight.slide,'slide surfaces are user content and must not be recolored');
  await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
  const dark=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  const violations=dark.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));
  await fs.writeFile(path.join(output,'axe-dark.json'),JSON.stringify({violations,incomplete:dark.incomplete.map(v=>v.id)},null,2));
  assert.equal(violations.length,0,JSON.stringify(violations));
  await shot('dark-overview-1920x1080-2x');
  await page.keyboard.press('KeyA');
  assert.equal((await read()).mode,'auto','the cycle returns to auto');
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 });
 await check('help traps focus, Escape does not reset the scene',async()=>{
  const focus=await attr('data-focused');await page.getByRole('button',{name:'키보드 단축키 (?)',exact:true}).click();
  await page.keyboard.press('Tab');assert.equal(await page.locator('.help-dialog').evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.help-dialog').count(),0);assert.equal(await attr('data-focused'),focus);
 });
 await check('basic accessibility audit at overview',async()=>{
  await page.getByRole('button',{name:'캔버스 전체 맞춤 (O)',exact:true}).click();
  await page.addScriptTag({path:path.join(root,'node_modules/axe-core/axe.min.js')});
  const report=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  const simplified=report.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>n.target)}));
  await fs.writeFile(path.join(output,'axe.json'),JSON.stringify({violations:simplified,incomplete:report.incomplete.map(v=>v.id)},null,2));
  assert.equal(simplified.length,0,JSON.stringify(simplified));
 });
 await check('1280 desktop and 800 narrow viewport keep controls accessible',async()=>{
  for(const width of [1280,800]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
   assert.ok(await page.getByRole('button',{name:'다음 슬라이드',exact:true}).isVisible());
   assert.ok(await page.getByRole('button',{name:'전체 화면 슬라이드 쇼 시작 (S)',exact:true}).isVisible());
   assert.ok(await page.getByRole('button',{name:/목차 (보기|숨기기)/}).isVisible());
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
   await shot(`responsive-${width}`);
  }
 });
 await check('standalone file opens offline, including HTML interaction',async()=>{
  await context.setOffline(true);await page.setViewportSize({width:1920,height:1080});
  await page.goto(pathToFileURL(path.resolve(demoDir,'grouped/index.html')).href);await idle();
  await page.getByRole('button',{name:'목차 슬라이드: 상호작용 장면',exact:true}).click();
  await page.getByRole('button',{name:'HTML 직접 조작',exact:true}).click();
  await clickInsideScaledFrame('iframe',page.frameLocator('iframe'),'질문 중심 보기');
  await page.frameLocator('iframe').getByText('궁금한 장면부터 살펴봅니다',{exact:true}).waitFor();
  await context.setOffline(false);
 });
 assert.equal(external.length,0,'unexpected external requests: '+external.join(', '));
 assert.equal(errors.length,0,'browser errors: '+errors.join(', '));
} catch(e){failures.push({name:'harness',error:e.stack});}
finally{await fs.writeFile(path.join(output,'browser-qa.json'),JSON.stringify({viewport:{width:1920,height:1080,dpr:2},results,failures,externalRequests:external,browserErrors:errors},null,2));await browser.close();}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:failures.length,failures},null,2));
if(failures.length)process.exitCode=1;
