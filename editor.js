// Simple 2D grid editor that exports layout.json understood by the game
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const DPR = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * DPR);
  canvas.height = Math.floor(h * DPR);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// World units: 1 unit == 1 meter
const state = {
  tool: 'room',                         // room | zone | door | select | prop
  grid: 0.5,                            // grid step meters
  rooms: [],                            // {id,name,x1,z1,x2,z2,door:{side,pos,width}}
  zones: [],                            // corridor rectangles {id,name?,x1,z1,x2,z2}
  props: [],                            // {id,type,x,z,rot}
  selected: null,                       // {kind:'room'|'zone'|'prop', id}
  drag: null,                           // current drag info
  hover: null,
  doorWidthDefault: 2.4,
  propType: 'camera'
};

function snap(v) { const g = state.grid; return Math.round(v/g)*g; }
function rectNorm(r){ let {x1,z1,x2,z2} = r; if(x1>x2) [x1,x2]=[x2,x1]; if(z1>z2) [z1,z2]=[z2,z1]; return {x1,z1,x2,z2}; }
function rectContains(r,x,z){ return x>r.x1 && x<r.x2 && z>r.z1 && z<r.z2; }
function rectWidth(r){ return Math.abs(r.x2 - r.x1); }
function rectDepth(r){ return Math.abs(r.z2 - r.z1); }
function uid(){ return Math.random().toString(36).slice(2,9); }

// Screen <-> world
let cam = { x:0, z:0, scale:20 }; // 20 px per meter
function worldToScreen(x,z){ return { x: canvas.width/DPR/2 + (x-cam.x)*cam.scale, y: canvas.height/DPR/2 + (z-cam.z)*cam.scale }; }
function screenToWorld(px,py){ return { x: cam.x + (px - canvas.width/DPR/2)/cam.scale, z: cam.z + (py - canvas.height/DPR/2)/cam.scale }; }

// Toolbar
for (const b of document.querySelectorAll('#bar [data-tool]')){
  b.addEventListener('click', ()=>{
    for (const bb of document.querySelectorAll('#bar [data-tool]')) bb.classList.remove('active');
    b.classList.add('active');
    state.tool = b.dataset.tool;
  });
}
document.getElementById('propType').addEventListener('change', e => state.propType = e.target.value);
document.getElementById('doorWidth').addEventListener('change', e => state.doorWidthDefault = parseFloat(e.target.value)||2.4);

document.getElementById('btnExport').addEventListener('click', ()=>{
  const layout = exportLayout();
  const blob = new Blob([JSON.stringify(layout, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'layout.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('btnImport').addEventListener('click', ()=>{
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const layout = JSON.parse(r.result);
      importLayout(layout);
    } catch(err){ alert('Invalid JSON'); }
  };
  r.readAsText(f);
});

// Mouse
let lastMouse = {x:0, y:0};
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  lastMouse = {x,y};
  const w = screenToWorld(x,y);
  if (e.button === 2) { // right click = delete under cursor
    deleteUnderCursor(w.x, w.z);
    draw(); return;
  }
  if (state.tool === 'room' || state.tool === 'zone') {
    state.drag = { kind: state.tool, start: {x:snap(w.x), z:snap(w.z)}, cur: {x:snap(w.x), z:snap(w.z)} };
  } else if (state.tool === 'prop') {
    const p = { id:uid(), type: state.propType, x: snap(w.x), z: snap(w.z), rot: 0 };
    state.props.push(p);
  } else if (state.tool === 'door') {
    const r = findRoomAt(w.x, w.z, 0.2);
    if (r) placeDoorOnClick(r, w.x, w.z);
  } else if (state.tool === 'select') {
    state.selected = hitTest(w.x, w.z);
    if (state.selected && state.selected.kind !== 'prop') {
      state.drag = { kind: state.selected.kind, id: state.selected.id, delta: {dx:0,dz:0}, mode:'moveRect' };
    } else if (state.selected && state.selected.kind === 'prop') {
      state.drag = { kind: 'prop', id: state.selected.id, delta:{dx:0,dz:0}, mode:'moveProp' };
    }
  }
  draw();
});

canvas.addEventListener('mousemove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const w = screenToWorld(x,y);
  lastMouse = {x,y};
  if (state.drag) {
    if (state.drag.kind === 'room' || state.drag.kind === 'zone') {
      state.drag.cur = {x:snap(w.x), z:snap(w.z)};
    } else if (state.drag.mode === 'moveRect') {
      const sel = getById(state.drag.kind, state.drag.id);
      if (sel) {
        const dx = snap(w.x) - snap(w.x); // noop snap baseline
        // We'll move by grid steps using wheel/keys; dragging free-move is cumbersome on big canvases—skip for now
      }
    } else if (state.drag.mode === 'moveProp') {
      const p = state.props.find(p=>p.id===state.drag.id);
      if (p){ p.x = snap(w.x); p.z = snap(w.z); }
    }
  } else {
    state.hover = hitTest(w.x, w.z);
  }
  draw();
});

window.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') state.drag = null;
  if (state.selected) {
    const step = (e.shiftKey? 1 : 0.5);
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      if (state.selected.kind === 'prop') {
        const p = state.props.find(p=>p.id===state.selected.id);
        if (p){
          if (e.key==='ArrowLeft') p.x -= step;
          if (e.key==='ArrowRight') p.x += step;
          if (e.key==='ArrowUp') p.z -= step;
          if (e.key==='ArrowDown') p.z += step;
        }
      } else {
        const r = getById(state.selected.kind, state.selected.id);
        if (r){
          if (e.key==='ArrowLeft'){ r.x1-=step; r.x2-=step; }
          if (e.key==='ArrowRight'){ r.x1+=step; r.x2+=step; }
          if (e.key==='ArrowUp'){ r.z1-=step; r.z2-=step; }
          if (e.key==='ArrowDown'){ r.z1+=step; r.z2+=step; }
        }
      }
      draw();
    }
    if (e.key === 'Delete') {
      deleteSelected();
      draw();
    }
    if (e.key.toLowerCase() === 'r' && state.selected.kind === 'prop') {
      const p = state.props.find(p=>p.id===state.selected.id);
      if (p){ p.rot = ((p.rot||0) + Math.PI/2) % (Math.PI*2); draw(); }
    }
  }
});

canvas.addEventListener('mouseup', ()=>{
  if (state.drag?.kind === 'room' || state.drag?.kind === 'zone') {
    let {start,cur} = state.drag;
    if (Math.hypot(cur.x-start.x, cur.z-start.z) < 0.01) { state.drag=null; draw(); return; }
    const r = rectNorm({x1:start.x, z1:start.z, x2:cur.x, z2:cur.z});
    if (state.drag.kind === 'room') {
      const name = prompt('Room name?', 'Room');
      state.rooms.push({ id:uid(), name: name||'Room', ...r, door: { side:'south', pos:0.5, width: state.doorWidthDefault } });
    } else {
      state.zones.push({ id:uid(), name:'Zone', ...r });
    }
  }
  state.drag = null;
  draw();
});

// Helpers
function findRoomAt(x,z, pad=0){
  for (const r of state.rooms){
    if (x>r.x1-pad && x<r.x2+pad && z>r.z1-pad && z<r.z2+pad) return r;
  }
  return null;
}
function hitTest(x,z){
  for (const p of state.props){
    if (Math.hypot(x-p.x, z-p.z) < 0.6) return {kind:'prop', id:p.id};
  }
  for (const r of state.rooms){
    if (rectContains(r,x,z)) return {kind:'room', id:r.id};
  }
  for (const r of state.zones){
    if (rectContains(r,x,z)) return {kind:'zone', id:r.id};
  }
  return null;
}
function getById(kind,id){
  if (kind==='prop') return state.props.find(p=>p.id===id);
  if (kind==='room') return state.rooms.find(r=>r.id===id);
  if (kind==='zone') return state.zones.find(r=>r.id===id);
  return null;
}
function deleteUnderCursor(x,z){
  // prefer props > rooms > zones
  for (let i=state.props.length-1;i>=0;i--){
    const p = state.props[i];
    if (Math.hypot(x-p.x, z-p.z) < 0.6){ state.props.splice(i,1); return; }
  }
  for (let i=state.rooms.length-1;i>=0;i--){
    if (rectContains(state.rooms[i], x,z)){ state.rooms.splice(i,1); return; }
  }
  for (let i=state.zones.length-1;i>=0;i--){
    if (rectContains(state.zones[i], x,z)){ state.zones.splice(i,1); return; }
  }
}
function deleteSelected(){
  if (!state.selected) return;
  const {kind,id} = state.selected;
  if (kind==='prop') state.props = state.props.filter(p=>p.id!==id);
  if (kind==='room') state.rooms = state.rooms.filter(r=>r.id!==id);
  if (kind==='zone') state.zones = state.zones.filter(r=>r.id!==id);
  state.selected=null;
}
function placeDoorOnClick(room, x, z){
  // Determine wall side nearest to click, place pos along that wall [0..1]
  const dLeft = Math.abs(x - room.x1), dRight = Math.abs(x - room.x2);
  const dTop = Math.abs(z - room.z1), dBot = Math.abs(z - room.z2);
  let side = 'south';
  let pos = 0.5;
  const w = rectWidth(room), d = rectDepth(room);
  if (dTop <= dBot && dTop <= dLeft && dTop <= dRight) {
    side = 'south'; // z1 wall
    pos = (x - room.x1) / Math.max(0.0001, w);
  } else if (dBot <= dLeft && dBot <= dRight) {
    side = 'north'; // z2
    pos = (x - room.x1) / Math.max(0.0001, w);
  } else if (dLeft <= dRight) {
    side = 'west'; // x1
    pos = (z - room.z1) / Math.max(0.0001, d);
  } else {
    side = 'east'; // x2
    pos = (z - room.z1) / Math.max(0.0001, d);
  }
  room.door = { side, pos: Math.max(0.05, Math.min(0.95, pos)), width: state.doorWidthDefault };
}

// Draw
function draw(){
  const w = canvas.width/DPR, h = canvas.height/DPR;
  ctx.clearRect(0,0,w,h);

  // grid
  const g = state.grid, step = cam.scale*g;
  const ox = (w/2 - (cam.x*cam.scale)) % step;
  const oz = (h/2 - (cam.z*cam.scale)) % step;
  ctx.strokeStyle = '#14233d';
  ctx.lineWidth = 1;
  for(let x=ox; x<w; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=oz; y<h; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  // zones
  for (const z of state.zones){
    const p1 = worldToScreen(z.x1, z.z1), p2 = worldToScreen(z.x2, z.z2);
    const x = Math.min(p1.x,p2.x), y = Math.min(p1.y,p2.y), ww = Math.abs(p2.x-p1.x), hh = Math.abs(p2.y-p1.y);
    ctx.fillStyle = '#0f1d33';
    ctx.strokeStyle = '#274069';
    ctx.fillRect(x,y,ww,hh);
    ctx.strokeRect(x,y,ww,hh);
  }

  // rooms
  for (const r of state.rooms){
    const p1 = worldToScreen(r.x1, r.z1), p2 = worldToScreen(r.x2, r.z2);
    const x = Math.min(p1.x,p2.x), y = Math.min(p1.y,p2.y), ww = Math.abs(p2.x-p1.x), hh = Math.abs(p2.y-p1.y);
    ctx.fillStyle = '#13345d';
    ctx.strokeStyle = '#2a7de1';
    ctx.fillRect(x,y,ww,hh);
    ctx.strokeRect(x,y,ww,hh);
    // name
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '12px system-ui';
    ctx.fillText(r.name || 'Room', x+6, y+16);
    // door
    if (r.door){
      ctx.strokeStyle = '#72ffe6';
      ctx.lineWidth = 3;
      const w = rectWidth(r), d = rectDepth(r);
      const half = (r.door.width||2.4)/2;
      if (r.door.side==='south' || r.door.side==='north'){
        const doorCenter = r.x1 + (r.door.pos||0.5)*w;
        const x1 = worldToScreen(doorCenter - half, r.door.side==='south'? r.z1 : r.z2);
        const x2 = worldToScreen(doorCenter + half, r.door.side==='south'? r.z1 : r.z2);
        ctx.beginPath(); ctx.moveTo(x1.x, x1.y); ctx.lineTo(x2.x, x2.y); ctx.stroke();
      } else {
        const doorCenter = r.z1 + (r.door.pos||0.5)*d;
        const y1 = worldToScreen(r.door.side==='west'? r.x1 : r.x2, doorCenter - half);
        const y2 = worldToScreen(r.door.side==='west'? r.x1 : r.x2, doorCenter + half);
        ctx.beginPath(); ctx.moveTo(y1.x, y1.y); ctx.lineTo(y2.x, y2.y); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
  }

  // props
  for (const p of state.props){
    const s = worldToScreen(p.x,p.z);
    ctx.fillStyle = '#ffef8a';
    ctx.strokeStyle = '#3a4a6a';
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0c213f';
    ctx.font = '10px system-ui';
    ctx.textAlign='center';
    ctx.fillText(iconFor(p.type), s.x, s.y+3);
  }

  // drag rect
  if (state.drag?.start && state.drag?.cur){
    const s = worldToScreen(state.drag.start.x, state.drag.start.z);
    const c = worldToScreen(state.drag.cur.x, state.drag.cur.z);
    const x = Math.min(s.x,c.x), y = Math.min(s.y,c.y), ww = Math.abs(c.x-s.x), hh = Math.abs(c.y-s.y);
    ctx.strokeStyle='#8ad4ff'; ctx.setLineDash([6,4]); ctx.strokeRect(x,y,ww,hh); ctx.setLineDash([]);
  }

  // selection
  if (state.selected){
    if (state.selected.kind==='prop'){
      const p = state.props.find(pp=>pp.id===state.selected.id);
      if (p){ const s = worldToScreen(p.x,p.z); ctx.strokeStyle='#fff'; ctx.strokeRect(s.x-10,s.y-10,20,20); }
    } else {
      const r = getById(state.selected.kind, state.selected.id);
      if (r){ const p1 = worldToScreen(r.x1,r.z1), p2=worldToScreen(r.x2,r.z2);
        const x = Math.min(p1.x,p2.x), y=Math.min(p1.y,p2.y), ww=Math.abs(p2.x-p1.x), hh=Math.abs(p2.y-p1.y);
        ctx.strokeStyle='#fff'; ctx.strokeRect(x-2,y-2,ww+4,hh+4);
      }
    }
  }
}
function iconFor(type){
  return ({
    camera:'C', wasteBag:'W', chair:'Ch', desk:'D', patientSpawn:'P'
  }[type] || '?');
}

// Export / Import
function exportLayout(){
  return {
    unitsPerMeter: 1,
    rooms: state.rooms.map(r => ({ id:r.id, name:r.name, x1:r.x1, z1:r.z1, x2:r.x2, z2:r.z2, door:r.door })),
    zones: state.zones.map(z => ({ id:z.id, name:z.name, x1:z.x1, z1:z.z1, x2:z.x2, z2:z.z2 })),
    props: state.props.map(p => ({ id:p.id, type:p.type, x:p.x, z:p.z, rot:p.rot||0 }))
  };
}
function importLayout(layout){
  state.rooms = (layout.rooms||[]).map(r=>({ ...r }));
  state.zones = (layout.zones||[]).map(z=>({ ...z }));
  state.props = (layout.props||[]).map(p=>({ ...p }));
  draw();
}

// Pan/zoom (mouse wheel)
canvas.addEventListener('wheel', (e)=>{
  if (e.ctrlKey){ // zoom
    const before = screenToWorld(e.offsetX, e.offsetY);
    cam.scale *= (e.deltaY<0? 1.1 : 1/1.1);
    cam.scale = Math.max(8, Math.min(80, cam.scale));
    const after = screenToWorld(e.offsetX, e.offsetY);
    cam.x += before.x - after.x; cam.z += before.z - after.z;
  } else { // pan
    cam.x -= e.deltaX / cam.scale;
    cam.z -= e.deltaY / cam.scale;
  }
  e.preventDefault();
  draw();
}, {passive:false});

// Initial draw
draw();
