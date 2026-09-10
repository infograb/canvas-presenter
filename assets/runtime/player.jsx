import React, {createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow, ReactFlowProvider, MiniMap, Background, Handle, Position, useReactFlow, useStore} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './theme.css';

const payload = JSON.parse(document.getElementById('canvas-data').textContent);
const Session = createContext(null);
const button = (text, onClick, props={}) => <button type="button" onClick={event=>{if(event.detail>0)event.currentTarget.blur();onClick(event);}} {...props}>{text}</button>;
const Ports = () => <><Handle type="target" position={Position.Top}/><Handle type="source" position={Position.Bottom}/></>;
const FrameNode = memo(function FrameNode({id,data}) {
  const session = useContext(Session);
  return <div className={`frame-card ${session.focused===id?'focused':''}`} style={{'--group-color':data.color || '#116B5E'}}>
    <Ports/>
    <header className="frame-title"><button type="button" className="nodrag" aria-label={`그룹: ${data.title}`}>{data.title}</button><span>{data.summary}</span></header>
  </div>;
});
const SlideNode = memo(function SlideNode({id,data}) {
  const session = useContext(Session);
  const focused = session.focused===id;
  const live = focused && data.format==='html' && !session.slideshow;
  const direct = live && session.direct;
  const image = data.format==='html' ? data.poster : data.asset;
  const nativeWidth = data.nativeWidth || 1920;
  const nativeHeight = data.nativeHeight || 1080;
  return <article className={`slide-card ${focused?'focused':''}`} data-slide-id={id} aria-label={`슬라이드: ${data.title}`}>
    <Ports/>
    <div className="slide-content" style={{height:480*nativeHeight/nativeWidth}}>
      {!live && (image ? <img src={image} alt={data.alt || data.title} draggable="false" decoding="async"/> : <div className="missing-poster"><strong>{data.title}</strong><p>HTML 미리보기가 없습니다.<br/>선택하면 원본을 표시합니다.</p></div>)}
      {live && <iframe key={id} title={`HTML 슬라이드: ${data.title}`} srcDoc={data.asset} sandbox={data.allowScripts?'allow-scripts':''} referrerPolicy="no-referrer" tabIndex={direct?0:-1} className={direct?'live-slide nodrag nopan nowheel':'live-slide'} style={{width:nativeWidth,height:nativeHeight,transform:`scale(${480/nativeWidth})`,pointerEvents:direct?'auto':'none'}}/>}
    </div>
  </article>;
});
const nodeTypes = {frame:FrameNode,slide:SlideNode};
const slideData = new Map(payload.nodes.filter(node=>node.type==='slide').map(node=>[node.id,{id:node.id,...node.data}]));
const bridgeScript=`<script data-canvas-presenter-bridge>(()=>{const commands=new Set(['arrowright','arrowdown','pagedown','j','l','arrowleft','arrowup','pageup','k','h','end','s','?','c']);addEventListener('keydown',event=>{const target=event.target;const editable=target?.matches?.('input,textarea,select,[contenteditable="true"]');const key=event.key.toLowerCase();const space=key===' '||event.code==='Space';if(key==='escape'||(!editable&&(commands.has(key)||space||/^[1-9]$/.test(key)))){parent.postMessage({type:'canvas-presenter:slideshow-key',key,code:event.code,shiftKey:event.shiftKey},'*');if(key!=='escape')event.preventDefault();}},true)})()<\/script>`;
function withBridge(source){
  const anchor=/<head\b[^>]*>/i.exec(source)||/<!doctype[^>]*>/i.exec(source);
  const at=anchor?anchor.index+anchor[0].length:0;
  return source.slice(0,at)+bridgeScript+source.slice(at);
}
const LASER_IDLE_MS = 760;
const DRAG_THRESHOLD = 8;
function Slideshow({slide,cursor,total,onExit,notice,onDismissNotice,containerRef,help,direct,onDirect}) {
  const surfaceRef = useRef(null);
  const laserRef = useRef(null);
  const boxRef = useRef(null);
  const gesture = useRef({laserTimer:0,laserFrame:0,laserPoint:null,drawFrame:0,drawPoint:null,drawState:null});
  const [area,setArea] = useState(()=>({width:innerWidth,height:innerHeight}));
  useEffect(()=>{
    const update=()=>setArea({width:innerWidth,height:innerHeight});
    window.addEventListener('resize',update);
    return ()=>window.removeEventListener('resize',update);
  },[]);
  const surfacePoint = (event)=>{
    const rect = surfaceRef.current.getBoundingClientRect();
    return {x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,event.clientY-rect.top))};
  };
  const hideLaser = useCallback(()=>{
    const state = gesture.current;
    clearTimeout(state.laserTimer); state.laserTimer = 0;
    if(state.laserFrame){cancelAnimationFrame(state.laserFrame);state.laserFrame = 0;}
    laserRef.current?.classList.remove('show');
    surfaceRef.current?.classList.remove('laser-active');
  },[]);
  const queueLaser = (point)=>{
    const state = gesture.current;
    state.laserPoint = point;
    if(!state.laserFrame) state.laserFrame = requestAnimationFrame(()=>{
      state.laserFrame = 0;
      const laser = laserRef.current;
      if(!laser) return;
      laser.style.left = `${state.laserPoint.x}px`;
      laser.style.top = `${state.laserPoint.y}px`;
      laser.classList.add('show');
      surfaceRef.current?.classList.add('laser-active');
    });
    clearTimeout(state.laserTimer);
    state.laserTimer = setTimeout(hideLaser,LASER_IDLE_MS);
  };
  const placeBox = (from,to)=>{
    const box = boxRef.current;
    if(!box) return;
    box.style.left = `${Math.min(from.x,to.x)}px`;
    box.style.top = `${Math.min(from.y,to.y)}px`;
    box.style.width = `${Math.abs(to.x-from.x)}px`;
    box.style.height = `${Math.abs(to.y-from.y)}px`;
    box.classList.add('show');
  };
  const queueBox = (point)=>{
    const state = gesture.current;
    state.drawPoint = point;
    if(!state.drawFrame) state.drawFrame = requestAnimationFrame(()=>{
      state.drawFrame = 0;
      if(state.drawState) placeBox(state.drawState.start,state.drawPoint);
    });
  };
  const endDraw = useCallback(()=>{
    const state = gesture.current;
    if(state.drawFrame){cancelAnimationFrame(state.drawFrame);state.drawFrame = 0;}
    state.drawState = null;
  },[]);
  const clearAnnotation = useCallback(()=>{
    hideLaser();
    endDraw();
    boxRef.current?.classList.remove('show');
  },[hideLaser,endDraw]);
  const onDown = (event)=>{
    if(event.button!==0 || !event.isPrimary || gesture.current.drawState) return;
    gesture.current.drawState = {id:event.pointerId,start:surfacePoint(event),dragging:false};
    try{surfaceRef.current.setPointerCapture(event.pointerId);}catch{}
    hideLaser();
  };
  const onMove = (event)=>{
    const state = gesture.current.drawState;
    if(!state || state.id!==event.pointerId){queueLaser(surfacePoint(event));return;}
    const point = surfacePoint(event);
    if(Math.hypot(point.x-state.start.x,point.y-state.start.y)>DRAG_THRESHOLD){state.dragging = true;queueBox(point);}
  };
  const onUp = (event)=>{
    const active = gesture.current.drawState;
    if(!active || active.id!==event.pointerId) return;
    if(active.dragging) placeBox(active.start,surfacePoint(event));
    else boxRef.current?.classList.remove('show');
    if(surfaceRef.current?.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
    endDraw();
  };
  const onLostCapture = (event)=>{ if(gesture.current.drawState?.id===event.pointerId) endDraw(); };
  useEffect(()=>{clearAnnotation();},[slide?.id,clearAnnotation]);
  useEffect(()=>clearAnnotation,[clearAnnotation]);
  const html = useMemo(()=>slide?.format==='html'?(slide.allowScripts?withBridge(slide.asset):slide.asset):'',[slide]);
  if(!slide) return null;
  const nativeWidth=slide.nativeWidth||1920;
  const nativeHeight=slide.nativeHeight||1080;
  const scale=Math.min(area.width/nativeWidth,area.height/nativeHeight);
  return <section className="slideshow" role="dialog" aria-modal="true" aria-label={`슬라이드 쇼: ${slide.title}`} aria-hidden={help?'true':undefined} tabIndex="-1" ref={containerRef} inert={help}>
    <div className="slideshow-media">
      <div className="slideshow-stage" style={{width:nativeWidth*scale,height:nativeHeight*scale}}>
        {slide.format==='html'
          ? <iframe key={slide.id} title={`HTML 슬라이드 쇼: ${slide.title}`} srcDoc={html} sandbox={slide.allowScripts?'allow-scripts':''} referrerPolicy="no-referrer" className="slideshow-frame" style={{width:nativeWidth,height:nativeHeight,transform:`scale(${scale})`}}/>
          : <img src={slide.asset} alt={slide.alt||slide.title} draggable="false"/>}
        <div ref={surfaceRef} className={`annotation-surface ${direct?'passthrough':''}`} aria-hidden="true"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onLostPointerCapture={onLostCapture}
          onPointerCancel={clearAnnotation} onPointerLeave={()=>{if(!gesture.current.drawState)hideLaser();}}>
          <div ref={boxRef} className="draw-box"/>
          <div ref={laserRef} className="laser-dot"/>
        </div>
      </div>
    </div>
    {notice&&<div className="slideshow-notice" role="status">{notice}{button('닫기',onDismissNotice)}</div>}
    <div className="slideshow-bar" role="toolbar" aria-label="발표 도구">
      {slide.format==='html'&&button(direct?'조작 켜짐':'직접 조작',()=>onDirect(!direct),{'aria-pressed':direct,title:'HTML 슬라이드를 마우스로 조작 (C)'})}
      <span className="slideshow-step" role="status" aria-live="polite">{cursor+1} / {total}</span>
      {button('종료',onExit,{className:'slideshow-exit',title:'슬라이드 쇼 종료 (S, Escape)'})}
    </div>
  </section>;
}
const index = new Map();
function indexTree(item,parent=null){ index.set(item.id,{...item,parent}); (item.children||[]).forEach(child=>indexTree(child,item.id)); }
indexTree(payload.tree);
const originalCounts = payload.counts;
const proOptions = {hideAttribution:true};

const Outline = memo(function OutlineItem({item,focus,focused,root=false}) {
  if(item.kind==='slide') return <li className="outline-leaf">{button(<span>{item.title}</span>,()=>focus(item.id),{'aria-current':focused===item.id?'true':undefined,'aria-label':`목차 슬라이드: ${item.title}`})}</li>;
  const children = <ul>{item.children.map(child=><Outline key={child.id} item={child} focus={focus} focused={focused}/>)}</ul>;
  return root ? children : <li className="outline-group"><details open><summary><span>{item.title}</span></summary>{button('그룹 전체 보기',()=>focus(item.id),{'aria-label':`목차 그룹: ${item.title}`})}{children}</details></li>;
});
function ZoomBadge(){
  const percent = useStore(state=>Math.round(state.transform[2]*100));
  return <span className="zoom-level">{percent}%</span>;
}
function readInitial(){
  const params = new URLSearchParams(location.hash.replace(/^#/,''));
  const path = payload.paths.find(p=>p.id===params.get('path')) || payload.paths.find(p=>p.id===payload.defaultPath) || payload.paths[0];
  const raw = params.has('step') ? Number(params.get('step')) : -1;
  const step = Number.isInteger(raw)&&raw>=-1&&raw<path.steps.length?raw:-1;
  const focus = params.get('focus');
  const fallbackFocus = step>=0 ? path.steps[step].target : 'overview';
  return {path:path.id,step,focus:focus&&Object.hasOwn(payload.boundsById,focus)?focus:fallbackFocus};
}
const initial = readInitial();
const THEME_KEY='canvas-presenter-theme';
const THEME_MODES=['auto','light','dark'];
const THEME_LABEL={auto:'화면 자동',light:'밝게',dark:'어둡게'};
function readTheme(){
 try{const stored=localStorage.getItem(THEME_KEY);if(THEME_MODES.includes(stored))return stored;}catch{}
 return 'auto';
}
// 미니맵과 배경 점은 React가 색을 넘겨야 한다. 값은 CSS 토큰 하나에서만 읽는다.
function readThemeColors(){
 const style=getComputedStyle(document.documentElement);
 const token=name=>style.getPropertyValue(name).trim();
 return {grid:token('--grid'),frame:token('--minimap-frame'),node:token('--minimap-node'),active:token('--brand'),stroke:token('--muted'),mask:token('--minimap-mask')};
}

function Player(){
  const rf = useReactFlow();
  const [initialized,setInitialized] = useState(false);
  const [focused,setFocused] = useState(initial.focus);
  const [pathId,setPathId] = useState(initial.path);
  const [cursor,setCursor] = useState(initial.step);
  const [slideshow,setSlideshow] = useState(false);
  const [minimap,setMinimap] = useState(true);
  const [outline,setOutline] = useState(()=>innerWidth>900);
  const [fullscreen,setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [notes,setNotes] = useState(false);
  const [help,setHelp] = useState(false);
  const [direct,setDirect] = useState(false);
  const [cameraDirty,setCameraDirty] = useState(false);
  const [reduced,setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [theme,setTheme] = useState(readTheme);
  const [themeColors,setThemeColors] = useState(readThemeColors);
  const [notice,setNotice] = useState('');
  const path = payload.paths.find(p=>p.id===pathId);
  const step = cursor>=0 ? path.steps[cursor] : null;
  const selected = index.get(focused);
  const detour = cameraDirty || focused!==(step?.target ?? 'overview');
  const stageRef = useRef(null);
  const slideshowRef = useRef(null);
  const slideshowOwnsFullscreen = useRef(false);
  const slideshowRequest = useRef(0);
  const firstFit = useRef(false);
  const pressAt = useRef(null);
  const refit = useRef(()=>{});
  useEffect(()=>{
    const root=document.documentElement;
    if(theme==='auto') delete root.dataset.theme; else root.dataset.theme=theme;
    try{if(theme==='auto')localStorage.removeItem(THEME_KEY);else localStorage.setItem(THEME_KEY,theme);}catch{}
    // 속성을 바꾼 직후 계산된 값은 이미 새 테마이다. rAF로 미루면 백그라운드 탭에서 영영 오지 않는다.
    const sync=()=>setThemeColors(readThemeColors());
    sync();
    const media=matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change',sync);
    return ()=>media.removeEventListener('change',sync);
  },[theme]);
  const focus = useCallback((id,duration=450,keepInteraction=false)=>{
    const target = id===payload.tree.id?'overview':id;
    if(!Object.hasOwn(payload.boundsById,target)) return;
    const bounds = payload.boundsById[target];
    if(!bounds) return;
    if(!keepInteraction){setDirect(false);setCameraDirty(false);}
    setFocused(target);
    const top=index.get(target)?.format==='html'?'110px':'62px';
    return rf.fitBounds(bounds,{padding:{top,bottom:minimap?'170px':'78px',left:'32px',right:'32px'},duration:reduced?0:Math.max(0,Math.min(duration,1500))});
  },[rf,reduced,minimap]);
  const nodeClick = useCallback((event,node)=>{
    const origin = pressAt.current;
    if(event.detail>0 && origin && Math.hypot(event.clientX-origin.x, event.clientY-origin.y) > 5) return;
    focus(node.id);
  },[focus]);
  const go = useCallback((next)=>{
    if(next<0 || next>=path.steps.length) return;
    setCursor(next);
    focus(path.steps[next].target,slideshow?0:(path.steps[next].duration ?? 450));
  },[path,focus,slideshow]);
  const fullScreen = useCallback(async()=>{
    try{ if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch{ setNotice('브라우저가 전체화면 요청을 허용하지 않았습니다. 창을 최대화해 사용하세요.'); }
  },[]);
  const exitSlideshow = useCallback(async()=>{
    slideshowRequest.current+=1;
    setSlideshow(false);
    setDirect(false);
    setNotice('');
    const shouldExit=slideshowOwnsFullscreen.current;
    slideshowOwnsFullscreen.current=false;
    if(shouldExit&&document.fullscreenElement){try{await document.exitFullscreen();}catch{}}
  },[]);
  const startSlideshow = useCallback(async()=>{
    const next=cursor>=0?cursor:0;
    const target=path.steps[next]?.target;
    if(!target) return;
    setDirect(false);
    const request=++slideshowRequest.current;
    setNotice('');
    setNotes(false);
    setCursor(next);
    focus(target,0);
    setSlideshow(true);
    if(document.fullscreenElement){slideshowOwnsFullscreen.current=true;return;}
    try{
      await document.documentElement.requestFullscreen();
      if(request!==slideshowRequest.current){if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}return;}
      slideshowOwnsFullscreen.current=Boolean(document.fullscreenElement);
    }catch{
      if(request!==slideshowRequest.current) return;
      slideshowOwnsFullscreen.current=false;
      setNotice('브라우저가 전체화면 요청을 허용하지 않았습니다. 슬라이드 쇼는 현재 창에서 계속됩니다.');
    }
  },[cursor,path,focus]);
  const ancestors = [];
  let ancestor = selected;
  while(ancestor && ancestor.id!==payload.tree.id){ancestors.unshift(ancestor);ancestor=index.get(ancestor.parent);}
  const parent = selected?.parent;
  const jumpParent = useCallback(()=>focus(parent&&parent!==payload.tree.id?parent:'overview'),[parent,focus]);
  const onInit = useCallback(()=>setInitialized(true),[]);
  const onMoveStart = useCallback(event=>{if(event)setCameraDirty(true);},[]);
  const dirtyCamera = useCallback(()=>setCameraDirty(true),[]);
  const paneClick = useCallback(()=>setDirect(false),[]);
  const minimapNodeColor = useCallback(node=>node.type==='frame'?themeColors.frame:focused===node.id?themeColors.active:themeColors.node,[focused,themeColors]);
  const minimapNodeClick = useCallback((_,node)=>focus(node.id),[focus]);

  useEffect(()=>{
    if(!initialized || !rf.viewportInitialized || firstFit.current) return;
    Promise.resolve(focus(initial.focus,0)).then(success=>{if(success!==false){firstFit.current=true;document.documentElement.dataset.canvasReady='true';}});
  },[initialized,rf.viewportInitialized,focus]);
  useEffect(()=>{
    const update=()=>{
      const active=Boolean(document.fullscreenElement);
      setFullscreen(active);
      if(!active&&slideshowOwnsFullscreen.current) exitSlideshow();
    };
    document.addEventListener('fullscreenchange',update);
    return ()=>document.removeEventListener('fullscreenchange',update);
  },[exitSlideshow]);
  useEffect(()=>{
    if(!slideshow) return;
    const opener=document.querySelector('[data-slideshow-toggle]');
    slideshowRef.current?.focus();
    return ()=>{if(opener?.isConnected)opener.focus();};
  },[slideshow]);
  useEffect(()=>{
    if(!slideshow) return;
    const handler=event=>{
      const frame=slideshowRef.current?.querySelector('iframe');
      const message=event.data;
      if(!frame||event.source!==frame.contentWindow||message?.type!=='canvas-presenter:slideshow-key') return;
      const key=String(message.key||'').toLowerCase();
      const space=key===' '||message.code==='Space';
      if(key==='escape'||key==='s') exitSlideshow();
      else if(key==='c') setDirect(v=>!v);
      else if(space&&message.shiftKey) go(cursor-1);
      else if(['arrowright','arrowdown','pagedown','j','l'].includes(key)||space) go(cursor+1);
      else if(['arrowleft','arrowup','pageup','k','h'].includes(key)) go(cursor-1);
      else if(key==='end') go(path.steps.length-1);
      else if(/^[1-9]$/.test(key)){const target=Number(key)-1;if(target<path.steps.length)go(target);}
      else if(key==='?') setHelp(true);
    };
    window.addEventListener('message',handler);
    return ()=>window.removeEventListener('message',handler);
  },[slideshow,cursor,go,path.steps.length,exitSlideshow]);
  useEffect(()=>{
    if(!help) return;
    const opener=document.querySelector('[data-help-toggle]');
    const dialog=document.querySelector('.help-dialog');
    dialog?.querySelector('button')?.focus();
    const trap=event=>{if(event.key!=='Tab')return;const items=[...dialog.querySelectorAll('button,a[href],input,select,[tabindex="0"]')];const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};
    document.addEventListener('keydown',trap);
    return ()=>{document.removeEventListener('keydown',trap);if(opener?.isConnected)opener.focus();};
  },[help]);
  useEffect(()=>{
    if(!initialized) return;
    const frame=requestAnimationFrame(()=>requestAnimationFrame(()=>focus(focused,0,true)));
    return ()=>cancelAnimationFrame(frame);
  },[outline,notes,minimap]);
  useEffect(()=>{refit.current=()=>focus(focused,0,true);},[focus,focused]);
  useEffect(()=>{
    const stage=stageRef.current;
    if(!stage) return;
    let timer;
    let size=null;
    const observer=new ResizeObserver(entries=>{
      const box=entries[entries.length-1]?.contentRect;
      if(!box) return;
      const next=`${Math.round(box.width)}x${Math.round(box.height)}`;
      if(size===next) return;
      const first=size===null;
      size=next;
      if(first) return;
      clearTimeout(timer);
      timer=setTimeout(()=>{if(firstFit.current)refit.current();},160);
    });
    observer.observe(stage);
    return ()=>{observer.disconnect();clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    const hash = new URLSearchParams({path:pathId,step:String(cursor),focus:focused});
    try{history.replaceState(null,'',`#${hash}`);}catch{}
  },[pathId,cursor,focused]);
  useEffect(()=>{
    const handler = event=>{
      if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const key=event.key.toLowerCase();
      const space=key===' '||event.code==='Space';
      if(key==='escape'){if(help){setHelp(false);return;}if(slideshow){exitSlideshow();return;}if(direct){setDirect(false);return;}focus('overview');return;}
      if(help) return;
      if(slideshow){
        if(event.target.closest?.('button,summary,a') && (space||key==='enter')) return;
        if(key==='c'){event.preventDefault();setDirect(v=>!v);return;}
        if(space&&event.shiftKey){event.preventDefault();go(cursor-1);}
        else if(['arrowright','arrowdown','pagedown','j','l'].includes(key)||space){event.preventDefault();go(cursor+1);}
        else if(['arrowleft','arrowup','pageup','k','h'].includes(key)){event.preventDefault();go(cursor-1);}
        else if(key==='end'){event.preventDefault();go(path.steps.length-1);}
        else if(/^[1-9]$/.test(key)){const target=Number(key)-1;if(target<path.steps.length){event.preventDefault();go(target);}}
        else if(key==='s'){event.preventDefault();exitSlideshow();}
        else if(key==='?'){event.preventDefault();setHelp(true);}
        return;
      }
      if(direct) return;
      if(event.target.closest?.('button,summary,a') && (space||key==='enter')) return;
      if(space&&event.shiftKey){event.preventDefault();go(cursor-1);}
      else if(['arrowright','arrowdown','pagedown','j','l'].includes(key)||space){event.preventDefault();go(cursor+1);}
      else if(['arrowleft','arrowup','pageup','k','h'].includes(key)){event.preventDefault();go(cursor-1);}
      else if(key==='end'){event.preventDefault();go(path.steps.length-1);}
      else if(key==='home'||key==='o'||key==='0'){event.preventDefault();focus('overview');}
      else if(/^[1-9]$/.test(key)){const target=Number(key)-1;if(target<path.steps.length){event.preventDefault();go(target);}}
      else if(key==='u'){event.preventDefault();jumpParent();}
      else if(key==='r'){event.preventDefault();focus(step?.target ?? 'overview');}
      else if(key==='s'){event.preventDefault();startSlideshow();}
      else if(key==='t'){event.preventDefault();setOutline(v=>!v);}
      else if(key==='m'){event.preventDefault();setMinimap(v=>!v);}
      else if(key==='n'){event.preventDefault();setNotes(v=>!v);}
      else if(key==='f'){event.preventDefault();fullScreen();}
      else if(key==='a'){event.preventDefault();setTheme(current=>THEME_MODES[(THEME_MODES.indexOf(current)+1)%THEME_MODES.length]);}
      else if(key==='+'||key==='='){event.preventDefault();setCameraDirty(true);rf.zoomIn({duration:reduced?0:180});}
      else if(key==='-'){event.preventDefault();setCameraDirty(true);rf.zoomOut({duration:reduced?0:180});}
      else if(key==='?'){event.preventDefault();setHelp(true);} 
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[cursor,go,focus,jumpParent,slideshow,help,direct,step,path.steps.length,fullScreen,startSlideshow,exitSlideshow,rf,reduced]);

  const context = useMemo(()=>({focused,direct,slideshow}),[focused,direct,slideshow]);
  const edges = useMemo(()=>payload.edges.map(e=>({...e,style:{stroke:'#526B73',strokeWidth:2.5},zIndex:5})),[]);
  const nodes = useMemo(()=>payload.nodes.map(n=>({...n,draggable:false,connectable:false,deletable:false,selectable:false,focusable:false,zIndex:n.type==='frame'?n.data.depth:20+n.data.depth})),[]);
  const exportManifest=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload.manifest,null,2)+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='canvas-manifest.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice('구조 JSON을 내려받았습니다. 원본 슬라이드 파일은 별도로 보관하세요.');
  };
  const pathChange=event=>{
    const next=payload.paths.find(p=>p.id===event.target.value);
    setPathId(next.id);setCursor(-1);focus('overview',0);
  };
  const statusLabel=cursor<0?`시작 전 · ${detour?'자유 탐색':'전체 윤곽'}`:`${cursor+1} / ${path.steps.length} · ${detour?'자유 탐색':step?.label || selected?.title || '슬라이드'}`;
  const statusText=cursor<0?`— / ${path.steps.length}`:`${cursor+1} / ${path.steps.length}`;
  const slideshowSlide=step?slideData.get(step.target):null;
  return <Session.Provider value={context}><><div className="app" data-focused={focused} data-step={cursor} data-path={pathId} data-slide-count={originalCounts.slides} data-slideshow={slideshow?'true':'false'}>
    <header className="app-header" aria-hidden={help||slideshow?'true':undefined} inert={help||slideshow}>
      <div className="brand-mark" aria-hidden="true">C</div>
      <div className="deck-heading"><h1>{payload.title}</h1><p>CANVAS PRESENTER <span>로컬 발표 캔버스</span></p></div>
      <div className="header-actions">
        {button(outline?'목차 숨기기':'목차 보기',()=>setOutline(v=>!v),{'aria-pressed':outline,className:'outline-toggle'})}
        {button(fullscreen?'전체화면 종료':'전체화면',fullScreen,{'aria-label':'전체화면 전환 (F)','aria-pressed':fullscreen})}
        {button('슬라이드 쇼',startSlideshow,{'aria-label':'전체 화면 슬라이드 쇼 시작 (S)','aria-pressed':slideshow,'data-slideshow-toggle':true,className:'primary'})}
        {button(THEME_LABEL[theme],()=>setTheme(current=>THEME_MODES[(THEME_MODES.indexOf(current)+1)%THEME_MODES.length]),{'aria-label':`화면 모드: ${THEME_LABEL[theme]} (A)`,'data-theme-toggle':true,title:'화면 모드를 자동·밝게·어둡게로 바꿉니다 (A)'})}
        {button('단축키',()=>setHelp(v=>!v),{'aria-haspopup':'dialog','aria-label':'키보드 단축키 (?)','data-help-toggle':true})}
      </div>
    </header>
    <div className="workspace" aria-hidden={help||slideshow?'true':undefined} inert={help||slideshow}>
      {outline&&<aside className="outline-panel" aria-label="내용 목차"><div className="panel-heading"><h2>내용의 구조</h2><p>{originalCounts.groups}개 그룹 · {originalCounts.slides}개 슬라이드</p></div>
        <div className="description">{payload.description}</div>
        {button('전체 윤곽 보기',()=>focus('overview'),{className:'overview-button','aria-current':focused==='overview'?'true':undefined})}
        <nav><Outline root item={payload.tree} focus={focus} focused={focused}/></nav>
        <div className="outline-bottom"><p>목차는 정보 위계이며, 아래 발표 경로와 독립적입니다.</p>{button('구조 JSON 저장',exportManifest)}</div>
      </aside>}
      <main className="stage" ref={stageRef} aria-label="확대 축소 발표 캔버스" onPointerDownCapture={event=>{pressAt.current={x:event.clientX,y:event.clientY};}}>
        <nav className="breadcrumb" aria-label="현재 위치">{button('전체',()=>focus('overview'))}{ancestors.map(item=><React.Fragment key={item.id}><span aria-hidden="true">/</span>{button(item.title,()=>focus(item.id))}</React.Fragment>)}</nav>
        <ReactFlow proOptions={proOptions} onInit={onInit} onMoveStart={onMoveStart} nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.025} maxZoom={4} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} panOnDrag zoomOnScroll zoomOnPinch zoomOnDoubleClick={false} onlyRenderVisibleElements onNodeClick={nodeClick} onPaneClick={paneClick} preventScrolling aria-label="슬라이드와 그룹을 배치한 캔버스">
          <Background color={themeColors.grid} gap={28} size={1.2}/>
          {minimap&&<div onPointerDown={dirtyCamera} onWheel={dirtyCamera}><MiniMap pannable zoomable ariaLabel="발표 미니맵: 드래그로 이동하고 휠로 확대합니다" nodeColor={minimapNodeColor} nodeStrokeColor={themeColors.stroke} nodeStrokeWidth={1.5} maskColor={themeColors.mask} maskStrokeColor={themeColors.active} maskStrokeWidth={2} onNodeClick={minimapNodeClick}/></div>}
        </ReactFlow>
        <div className="camera-controls" role="toolbar" aria-label="카메라 조작">
          {button('+',()=>{setCameraDirty(true);rf.zoomIn({duration:reduced?0:180});},{'aria-label':'확대'})}
          <ZoomBadge/>
          {button('−',()=>{setCameraDirty(true);rf.zoomOut({duration:reduced?0:180});},{'aria-label':'축소'})}
          {button('전체',()=>focus('overview'),{'aria-label':'캔버스 전체 맞춤 (O)'})}
          {button('상위',jumpParent,{'aria-label':'상위 그룹으로 이동 (U)',disabled:focused==='overview'})}
          {button('미니맵',()=>setMinimap(v=>!v),{'aria-pressed':minimap})}
        </div>
        {selected?.format==='html'&&<div className={`interaction-bar ${direct?'active':''}`}>{button(direct?'HTML 조작 종료':'HTML 직접 조작',()=>{setDirect(v=>!v);document.activeElement?.blur();},{'aria-pressed':direct})}<span>{direct?'슬라이드가 마우스 입력을 받습니다. 이 버튼으로 캔버스로 돌아오세요.':'탐색 중에는 슬라이드 위에서도 캔버스를 이동할 수 있습니다.'}</span></div>}
        {notice&&!slideshow&&<div className="notice" role="status">{notice}{button('닫기',()=>setNotice(''))}</div>}
      </main>
      {notes&&<aside className="notes-panel" aria-label="발표 노트"><h2>발표 노트</h2><p className="note-warning">이 패널은 현재 화면에 표시됩니다. 화면 공유 범위를 확인하세요.</p><h3>{step?.label||index.get(step?.target)?.title||'전체 윤곽'}</h3><p>{step?.notes||index.get(step?.target)?.notes||'다음 슬라이드를 누르면 발표를 시작합니다.'}</p>{detour&&<><hr/><h3>탐색 중: {selected?.title||'전체'}</h3><p>{selected?.notes||selected?.summary||'전체 구성을 살펴봅니다.'}</p></>}{button('노트 닫기',()=>setNotes(false))}</aside>}
    </div>
    <footer className="presentation-bar" aria-hidden={help||slideshow?'true':undefined} inert={help||slideshow}>
      <label>발표 경로 <select value={pathId} onChange={pathChange} aria-label="발표 경로 선택">{payload.paths.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <div className="path-controls">{button('이전',()=>go(cursor-1),{disabled:cursor<=0,'aria-label':'이전 슬라이드','title':'이전 슬라이드 (←, ↑, Page Up, K)'})}<span className="step-status" role="status" aria-live="polite" aria-label={statusLabel}>{statusText}</span>{button('다음',()=>go(cursor+1),{disabled:cursor>=path.steps.length-1,'aria-label':'다음 슬라이드','title':'다음 슬라이드 (→, ↓, Page Down, Space, J)',className:'primary'})}</div>
      <div className="footer-actions">{button('발표 경로 복귀',()=>focus(step?.target ?? 'overview'),{className:detour?'resume':'',title:'현재 발표 슬라이드로 복귀 (R)'})}{button('노트',()=>setNotes(v=>!v),{'aria-pressed':notes})}<label className="reduce-motion"><input type="checkbox" checked={reduced} onChange={event=>setReduced(event.target.checked)}/>모션 줄이기</label></div>
    </footer>
    {help&&<div className="help-backdrop" onClick={()=>setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="키보드 단축키" onClick={event=>event.stopPropagation()}><h2>키보드 단축키</h2><p>이전·다음은 그룹이나 전체보기를 거치지 않고 현재 발표 경로의 슬라이드 사이에서만 이동합니다. 전체 윤곽과 그룹은 탐색용 보기입니다.</p><dl><dt>→ · ↓ · Page Down · Space · J · L</dt><dd>다음 슬라이드</dd><dt>← · ↑ · Page Up · Shift+Space · K · H</dt><dd>이전 슬라이드</dd><dt>1~9 · End</dt><dd>해당 번호 슬라이드 · 마지막 슬라이드</dd><dt>0 · O · Home</dt><dd>전체 윤곽</dd><dt>U · R</dt><dd>상위 그룹 · 현재 발표 슬라이드로 복귀</dd><dt>+ · −</dt><dd>확대 · 축소</dd><dt>F · S · T · M · N</dt><dd>전체화면 · 슬라이드 쇼 · 목차 · 미니맵 · 노트</dd><dt>A</dt><dd>화면 모드: 자동 · 밝게 · 어둡게</dd><dt>C</dt><dd>슬라이드 쇼에서 HTML 슬라이드 직접 조작 전환</dd><dt>? · Escape</dt><dd>단축키 열기 · 현재 모드 닫기</dd></dl><p>슬라이드 쇼가 발표 화면입니다. 슬라이드가 화면을 가득 채우고 막대만 아래에 겹칩니다. 마우스를 움직이면 레이저 점이 따라오고 멈추면 사라집니다. 끌면 강조 상자가 그려지고, 한 번 누르면 지워집니다. 장을 넘겨도 지워집니다. HTML 슬라이드를 마우스로 다루려면 직접 조작을 켜세요.</p><p>슬라이드 쇼는 현재 슬라이드에서 시작하고, 시작 전에는 첫 슬라이드부터 재생합니다. 이동은 방향키·Space·번호 키로 하고 Escape 또는 S로 종료합니다.</p><p>목차나 캔버스의 카드를 누르면 발표 순서를 바꾸지 않고 자유롭게 탐색합니다. 캔버스에서는 HTML을 선택한 슬라이드 하나만 실행합니다. 직접 조작 중에는 슬라이드가 키보드 입력을 받으므로 화면의 조작 종료 버튼을 사용하세요.</p><p>이 도구는 발표용입니다. 위치와 그룹은 구조 JSON에서 바꾸며, 슬라이드 자체를 편집하거나 PDF로 변환하지 않습니다.</p>{button('단축키 닫기',()=>setHelp(false),{className:'primary'})}</section></div>}
  </div>
  {slideshow&&<Slideshow slide={slideshowSlide} cursor={cursor} total={path.steps.length} onExit={exitSlideshow} notice={notice} onDismissNotice={()=>setNotice('')} containerRef={slideshowRef} help={help} direct={direct} onDirect={setDirect}/>}
  </></Session.Provider>;
}

class Boundary extends React.Component {
  state={error:null};
  static getDerivedStateFromError(error){return {error:String(error.message||error)};}
  render(){return this.state.error?<main className="fatal"><h1>캔버스를 열지 못했습니다</h1><p>{this.state.error}</p><p>구조 JSON을 validate 명령으로 검사한 뒤 다시 생성하세요.</p></main>:this.props.children;}
}
createRoot(document.getElementById('root')).render(<Boundary><ReactFlowProvider><Player/></ReactFlowProvider></Boundary>);
