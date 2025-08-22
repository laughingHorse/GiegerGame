// ==============================
// Imports
// ==============================
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ==============================
// DOM handles (expected in index.html)
// ==============================
const overlay   = document.getElementById('overlay');
const startBtn  = document.getElementById('startBtn');
const statusMsg = document.getElementById('statusMsg');
const gaugeCanvas = document.getElementById('gauge');

// Spawn point (updated after we build a layout)
let spawnPoint = new THREE.Vector3(-30, 1.6, -18);
function setSpawnInsideRect(rect){
  const cx = (Math.min(rect.x1,rect.x2) + Math.max(rect.x1,rect.x2)) / 2;
  const cz = (Math.min(rect.z1,rect.z2) + Math.max(rect.z1,rect.z2)) / 2;
  spawnPoint.set(cx, 1.6, cz);
}


// ==============================
// Three.js setup
// ==============================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf2fb); // clinic light blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lights
scene.add(new THREE.HemisphereLight(0xf2f7ff, 0xcfd6de, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.65);
sun.position.set(50, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// Floor (vinyl)
const floorTex = new THREE.Texture(generateFloorTexture());
floorTex.needsUpdate = true;
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(11, 8);
const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.96, metalness: 0 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), floorMat);
floor.rotation.x = -Math.PI/2;
floor.receiveShadow = true;
scene.add(floor);

// ==============================
// Geometry registries
// ==============================
const colliders = [];
const roomBounds = [];   // {name,x1,z1,x2,z2}
const wasteBags = [];
const patients  = [];

// ==============================
// Helpers: walls, rooms, signs
// ==============================
function addWallBox(x, y, z, sx, sy, sz, color=0xdfeaf5) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness:0.93, metalness:0 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  // collider AABB
  const half = new THREE.Vector3(sx/2, sy/2, sz/2);
  colliders.push({ min:new THREE.Vector3(x,y,z).sub(half), max:new THREE.Vector3(x,y,z).add(half) });
  return mesh;
}

function makeSignTexture(text, sub="") {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 180;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f7fbff"; ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle = "#2a7de1"; ctx.lineWidth = 6; ctx.strokeRect(8,8,c.width-16,c.height-16);
  ctx.fillStyle = "#0d2a4d"; ctx.font = "bold 44px system-ui,Segoe UI,Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, c.width/2, c.height/2 - (sub ? 24 : 0));
  if (sub){
    ctx.font = "28px system-ui,Segoe UI,Arial"; ctx.fillStyle="#2a7de1";
    ctx.fillText(sub, c.width/2, c.height/2 + 24);
  }
  const tex = new THREE.Texture(c); tex.needsUpdate = true; return tex;
}

function addWallSign(text, x, z, facing='north') {
  const tex = makeSignTexture(text);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0,0.7), mat);
  const y = 1.6, off = 0.06;
  if (facing==='north'){ sign.position.set(x, y, z+off); sign.rotation.y = 0; }
  if (facing==='south'){ sign.position.set(x, y, z-off); sign.rotation.y = Math.PI; }
  if (facing==='east' ){ sign.position.set(x+off, y, z); sign.rotation.y = -Math.PI/2; }
  if (facing==='west' ){ sign.position.set(x-off, y, z); sign.rotation.y =  Math.PI/2; }
  scene.add(sign);
}

function addRoom(name, x1,z1,x2,z2, doorSide="south", doorCenter=0, doorWidth=2.4, height=3) {
  if(x1>x2) [x1,x2]=[x2,x1];
  if(z1>z2) [z1,z2]=[z2,z1];
  const cx = (x1+x2)/2, cz = (z1+z2)/2;
  const w = (x2-x1), d = (z2-z1);
  const wallT = 0.35, h = height;
  const color = 0xdfeaf5;

  const splitWall = (side) => {
    const isZ = (side==='south' || side==='north');
    const dc = (isZ? cx : cz) + doorCenter, half = doorWidth/2;
    if (isZ) {
      const leftW = Math.max(0.1, (dc - half) - x1);
      const rightW= Math.max(0.1, x2 - (dc + half));
      if (leftW>0.1) addWallBox(x1 + leftW/2, h/2, side==='south'? z1 : z2, leftW, h, wallT, color);
      if (rightW>0.1) addWallBox(x2 - rightW/2, h/2, side==='south'? z1 : z2, rightW, h, wallT, color);
    } else {
      const topD = Math.max(0.1, (dc - half) - z1);
      const botD = Math.max(0.1, z2 - (dc + half));
      if (topD>0.1) addWallBox(side==='west'? x1 : x2, h/2, z1 + topD/2, wallT, h, topD, color);
      if (botD>0.1) addWallBox(side==='west'? x1 : x2, h/2, z2 - botD/2, wallT, h, botD, color);
    }
  };

  (doorSide==="south") ? splitWall("south") : addWallBox(cx, h/2, z1, w, h, wallT, color);
  (doorSide==="north") ? splitWall("north") : addWallBox(cx, h/2, z2, w, h, wallT, color);
  (doorSide==="west" ) ? splitWall("west" ) : addWallBox(x1, h/2, cz, wallT, h, d, color);
  (doorSide==="east" ) ? splitWall("east" ) : addWallBox(x2, h/2, cz, wallT, h, d, color);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xf5f9ff, transparent:true, opacity:0.5 }));
  ceil.rotation.x = Math.PI/2; ceil.position.set(cx, h+0.02, cz); scene.add(ceil);

  roomBounds.push({name, x1,z1,x2,z2});
  return { cx, cz, w, d, x1,z1,x2,z2, doorSide };
}

// ==============================
// Props
// ==============================
function addDesk(x,z,w=4.8,d=1.8, h=0.9) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe1e7ef, roughness:0.95 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x, h/2, z); m.castShadow=m.receiveShadow=true; scene.add(m);
}

function addChair(x,z, rot=0){
  const group = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.05,0.55), new THREE.MeshStandardMaterial({ color: 0xdfe7f1, roughness:0.95 }));
  seat.position.set(0, 0.45, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.45,0.05), new THREE.MeshStandardMaterial({ color: 0xc9d7e6, roughness:0.95 }));
  back.position.set(0, 0.725, -0.25);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xb8c2cf, roughness:0.7, metalness:0.1 });
  const legGeo = new THREE.CylinderGeometry(0.03,0.03,0.45,10);
  const legs = [new THREE.Mesh(legGeo, legMat),new THREE.Mesh(legGeo, legMat),new THREE.Mesh(legGeo, legMat),new THREE.Mesh(legGeo, legMat)];
  legs[0].position.set(-0.24,0.225,-0.24); legs[1].position.set(0.24,0.225,-0.24);
  legs[2].position.set(-0.24,0.225,0.24);  legs[3].position.set(0.24,0.225,0.24);
  [seat,back,...legs].forEach(m=>{ m.castShadow=m.receiveShadow=true; group.add(m); });
  group.position.set(x,0,z); group.rotation.y = rot; scene.add(group);
  return group;
}

function addSymbiaCamera(cx, cz, yaw = 0) {
  const group = new THREE.Group(); group.position.set(cx,0,cz); group.rotation.y = yaw;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 18, 72), new THREE.MeshStandardMaterial({ color: 0xe9f2f8, roughness: 0.6 }));
  ring.rotation.y = Math.PI/2; ring.position.set(0,1.1,0);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xb7dce8, roughness: 0.5 });
  const headGeo = new THREE.BoxGeometry(1.3, 0.45, 0.9);
  const headTop = new THREE.Mesh(headGeo, headMat);    headTop.position.set(0.95, 1.55, 0.0);
  const headBottom = new THREE.Mesh(headGeo, headMat); headBottom.position.set(0.95, 0.65, 0.0);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 0.8), new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.95 }));
  bed.position.set(0, 0.7, 0);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0xdfe7f1, roughness: 0.9 }));
  base.position.set(-1.8, 0.35, 0);
  [ring, headTop, headBottom, bed, base].forEach(m=>{ m.castShadow=m.receiveShadow=true; group.add(m); });
  scene.add(group);
  return group;
}

function makeTrefoilTexture(){
  const c = document.createElement('canvas'); c.width=256; c.height=256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,256,256);
  ctx.fillStyle="#ffdd33"; ctx.beginPath(); ctx.arc(128,128,120,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#222";
  for(let i=0;i<3;i++){
    ctx.save(); ctx.translate(128,128); ctx.rotate(i*2*Math.PI/3);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,90,Math.PI/6,Math.PI/2.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(128,128,26,0,Math.PI*2); ctx.fill();
  const tex = new THREE.Texture(c); tex.needsUpdate=true; return tex;
}
const trefoilTex = makeTrefoilTexture();

function addWasteBag(x,z){
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = Math.PI;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35,22,18), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness:0.8 }));
  body.scale.y = 1.2; body.position.y = 0.45;
  const neck = new THREE.Mesh(new THREE.ConeGeometry(0.12,0.22,14), new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness:0.9 })); neck.position.y = 0.9;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.28,0.28), new THREE.MeshBasicMaterial({ map: trefoilTex, transparent:true }));
  label.position.set(0.0,0.75,0.34);
  [body, neck, label].forEach(m=>{ m.castShadow=m.receiveShadow=true; g.add(m); });
  scene.add(g);
  return g;
}

function addPatient(x,z, facing=0) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8f0f8, roughness:0.95 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), bodyMat); head.position.set(x, 1.65, z);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 6, 12), bodyMat); torso.position.set(x, 1.0, z); torso.rotation.y = facing;
  [head, torso].forEach(m => { m.castShadow=m.receiveShadow=true; scene.add(m); });
  patients.push({ x, z, meshes:[head,torso], hot:false });
}

// ==============================
// Pointer lock & controls
// ==============================
const controls = new PointerLockControls(camera, document.body);
function hideOverlay(){ overlay && (overlay.style.display='none'); }
function showOverlay(){ overlay && (overlay.style.display='flex'); }

document.addEventListener('pointerlockerror', () => setStatus('Pointer lock error. Click the 3D view to enter.'));
controls.addEventListener('lock',   () => { hideOverlay(); resumeClicks(); setStatus('Pointer locked.'); });
controls.addEventListener('unlock', () => { showOverlay(); pauseClicks(); setStatus('Pointer unlocked.'); });

startBtn?.addEventListener('click', () => { hideOverlay(); try { controls.lock(); } catch(e){} });
document.body.addEventListener('click', () => { if (!controls.isLocked) { try { controls.lock(); } catch(e){} } });

camera.position.set(-30, 1.6, -18);
camera.lookAt(0, 1.6, 0);

let moveF=0, moveB=0, moveL=0, moveR=0, sprint=0;
const speed = 3.4, sprintBoost = 1.15;

// ==============================
// Movement + collisions
// ==============================
const player = { radius: 0.35 };

function aabbCollidePointExpanded(aabb, p, r) {
  return (p.x > aabb.min.x - r && p.x < aabb.max.x + r &&
          p.y > aabb.min.y - r && p.y < aabb.max.y + r &&
          p.z > aabb.min.z - r && p.z < aabb.max.z + r);
}

function resolveCollisions(next) {
  for (const a of colliders) {
    if (aabbCollidePointExpanded(a, next, player.radius)) {
      const penX1 = (a.max.x + player.radius) - next.x;
      const penX2 = next.x - (a.min.x - player.radius);
      const penZ1 = (a.max.z + player.radius) - next.z;
      const penZ2 = next.z - (a.min.z - player.radius);
      const minPen = Math.min(penX1, penX2, penZ1, penZ2);
      if (minPen === penX1) next.x = a.max.x + player.radius;
      else if (minPen === penX2) next.x = a.min.x - player.radius;
      else if (minPen === penZ1) next.z = a.max.z + player.radius;
      else next.z = a.min.z - player.radius;
    }
  }
  return next;
}

function currentRoomName(px, pz) {
  for (const r of roomBounds) if (px>r.x1 && px<r.x2 && pz>r.z1 && pz<r.z2) return r.name;
  return "Main Corridor";
}

// ==============================
// Input
// ==============================
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code==='KeyW') moveF=1;
  if (e.code==='KeyS') moveB=1;
  if (e.code==='KeyA') moveL=1;  // A = left
  if (e.code==='KeyD') moveR=1;  // D = right
  if (e.code==='ShiftLeft' || e.code==='ShiftRight') sprint=1;

  if (e.code==='KeyE') tryMarkContamination();
  if (e.code==='KeyR') resetScenario();
  if (e.code==='KeyH') flashHints();
  if (e.code==='KeyG') {
    const info = nearestContamInfo();
    setStatus(info ? `Nearest contamination ≈ ${info.dist.toFixed(1)} m in ${info.room}` : 'No remaining contamination.');
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code==='KeyW') moveF=0;
  if (e.code==='KeyS') moveB=0;
  if (e.code==='KeyA') moveL=0;
  if (e.code==='KeyD') moveR=0;
  if (e.code==='ShiftLeft' || e.code==='ShiftRight') sprint=0;
});

// ==============================
// Radiation model & gameplay
// ==============================
const sources = []; // {pos,strength,isPatient,isContamination,found,marker}
const rand = (a,b)=>a + Math.random()*(b-a);
const pickN = (arr,n)=>arr.slice().sort(()=>Math.random()-0.5).slice(0,n);

let contaminationToFind = 3;
const neededCountEl = document.getElementById("neededCount");
if (neededCountEl) neededCountEl.textContent = contaminationToFind;

function makeContaminationBlob(){
  const g = new THREE.CircleGeometry(0.45, 18);
  const m = new THREE.MeshBasicMaterial({ color: 0x22cc88, transparent:true, opacity:0.22 });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI/2;
  const pin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 16), new THREE.MeshBasicMaterial({ color:0x22cc88 }));
  pin.position.set(0, 0.25, 0); pin.visible = false; mesh.add(pin); mesh.pin = pin;
  return mesh;
}

function seedScenario() {
  // clear old markers (keep static meshes)
  for (const s of sources) { if (s.marker) scene.remove(s.marker); }
  sources.length = 0;

  // Hot patients (~half)
  const hotPatients = pickN(patients, Math.ceil(patients.length/2));
  patients.forEach(p => p.hot = hotPatients.includes(p));
  for (const p of patients) if (p.hot) {
    sources.push({ pos:new THREE.Vector3(p.x,1.0,p.z), strength:rand(80,130), isPatient:true, isContamination:false, found:false, marker:null });
  }

  // Waste bags hot
  for (const bag of wasteBags) {
    const wp = new THREE.Vector3(); bag.getWorldPosition(wp);
    sources.push({ pos: wp.clone().setY(1.0), strength: rand(220,320), isPatient:false, isContamination:false, found:false, marker:null });
  }

  // Mild hot: center of any "Injection" room
  const inj = roomBounds.find(r => /inject/i.test(r.name));
  if (inj) {
    const cx = (inj.x1+inj.x2)/2, cz=(inj.z1+inj.z2)/2;
    sources.push({ pos:new THREE.Vector3(cx,1.0,cz), strength:160, isPatient:false, isContamination:false, found:false, marker:null });
  }

  // Areas for contamination
  const contamAreas = (window.__spawnAreas && window.__spawnAreas.length)
    ? window.__spawnAreas
    : (window.__builtinCorridorRect ? roomBounds.concat([window.__builtinCorridorRect]) : roomBounds);

  function randomPointInRect(rect, margin = 0.8) {
    const x1 = Math.min(rect.x1,rect.x2) + margin, x2 = Math.max(rect.x1,rect.x2) - margin;
    const z1 = Math.min(rect.z1,rect.z2) + margin, z2 = Math.max(rect.z1,rect.z2) - margin;
    return new THREE.Vector3(rand(x1, x2), 0.01, rand(z1, z2));
  }
  function tooCloseToNonContam(p, min=2.2){
    for (const s of sources) if (!s.isContamination) {
      const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z); if (d < min) return true;
    }
    return false;
  }
  function tooCloseToOtherContam(p, min=1.8){
    for (const s of sources) if (s.isContamination) {
      const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z); if (d < min) return true;
    }
    return false;
  }
  function placeOneContam(relaxed=false){
    let tries = 0;
    while (tries++ < (relaxed? 160 : 120)) {
      const area = contamAreas[Math.floor(Math.random() * contamAreas.length)];
      const v = randomPointInRect(area, 0.9);
      if (relaxed || (!tooCloseToNonContam(v) && !tooCloseToOtherContam(v))) {
        const blob = makeContaminationBlob(); blob.position.copy(v); scene.add(blob);
        sources.push({ pos:v.clone(), strength:rand(90,140), isPatient:false, isContamination:true, found:false, marker:blob });
        return true;
      }
    }
    return false;
  }

  // Guarantee exactly 3 contamination
  let placed = 0;
  while (placed < contaminationToFind) {
    if (placeOneContam(false) || placeOneContam(true)) { placed++; continue; }
    // fallback: center of overall extents
    const ext = getOverallExtents();
    const v = new THREE.Vector3((ext.x1+ext.x2)/2, 0.01, (ext.z1+ext.z2)/2);
    const blob = makeContaminationBlob(); blob.position.copy(v); scene.add(blob);
    sources.push({ pos:v.clone(), strength:rand(90,140), isPatient:false, isContamination:true, found:false, marker:blob });
    placed++;
    console.warn('⚠️ Fallback contamination placed at center.');
  }

  foundCount = 0;
  updateFoundHud();
  setStatus("Sweep started — listen for the clicks.");
  const vic = document.getElementById('victory'); if (vic) vic.style.display = 'none';

  // Reset player start (inside the layout)
  camera.position.copy(spawnPoint);
  controls.object.position.copy(spawnPoint);


  // Log spots
  const coords = sources.filter(s=>s.isContamination).map(s=>`(${s.pos.x.toFixed(1)}, ${s.pos.z.toFixed(1)})`);
  console.log('🟢 Contamination spots:', coords.join(', '));
}

function resetScenario(){ seedScenario(); }

function nearestContamInfo(){
  let best = Infinity, bestS = null;
  for (const s of sources) if (s.isContamination && !s.found){
    const d = Math.hypot(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
    if (d < best) { best = d; bestS = s; }
  }
  return bestS ? { dist: best, room: currentRoomName(bestS.pos.x, bestS.pos.z), pos: bestS.pos.clone() } : null;
}

let foundCount = 0;

function updateFoundHud(){
  const el = document.getElementById('foundCount'); if (el) el.textContent = foundCount;
  const need = document.getElementById('neededCount'); if (need) need.textContent = contaminationToFind;
  if (foundCount >= contaminationToFind) {
    const vic = document.getElementById('victory'); if (vic) vic.style.display = 'flex';
    setStatus("All contamination found. Nice sweep!");
  }
}

function tryMarkContamination(){
  let did=false;
  for (const s of sources) if (s.isContamination && !s.found){
    const d = Math.hypot(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
    if (d < 1.25) {
      s.found=true;
      if (s.marker?.pin) s.marker.pin.visible=true;
      foundCount++; updateFoundHud(); setStatus("Marked contamination ✅");
      did=true;
    }
  }
  if (!did) setStatus("No contamination here. Sweep closer to the peak.");
}

function intensityAt(pos) {
  let sum = 0;
  for (const s of sources) {
    const dx = pos.x - s.pos.x, dy = pos.y - s.pos.y, dz = pos.z - s.pos.z;
    const dist2 = dx*dx + dy*dy + dz*dz;
    sum += s.strength / (dist2 + 0.25);
  }
  return sum;
}

// ==============================
// Gauge
// ==============================
let gctx = null, smoothed = 0, geigerRate = 0;

if (gaugeCanvas) {
  const cssW = 420, cssH = 240, DPR = Math.min(window.devicePixelRatio || 1, 2);
  Object.assign(gaugeCanvas.style, { position:'fixed', right:'12px', bottom:'12px', zIndex:'10', width:cssW+'px', height:cssH+'px', pointerEvents:'none' });
  gaugeCanvas.width  = Math.floor(cssW * DPR);
  gaugeCanvas.height = Math.floor(cssH * DPR);
  gctx = gaugeCanvas.getContext('2d'); gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function drawGauge(value) {
  if (!gctx || !gaugeCanvas) return;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const w = gaugeCanvas.width / DPR, h = gaugeCanvas.height / DPR;
  gctx.clearRect(0,0,w,h);
  gctx.fillStyle = "rgba(247,250,255,0.9)"; gctx.fillRect(0,0,w,h);
  gctx.strokeStyle = "#b7c6d9"; gctx.lineWidth = 8; gctx.strokeRect(8,8,w-16,h-16);
  const cx = w*0.5, cy = h*0.86, radius = Math.min(w,h)*0.41;
  gctx.save(); gctx.translate(cx, cy);
  const start = Math.PI*0.85, end = Math.PI*0.15;
  gctx.beginPath(); gctx.arc(0,0,radius, start, end, true);
  gctx.strokeStyle = "#6b8db3"; gctx.lineWidth = 4; gctx.stroke();
  for(let i=0;i<=10;i++){
    const t = i/10, ang = start + (end-start)*t;
    const x1 = Math.cos(ang)*radius, y1 = Math.sin(ang)*radius;
    const x2 = Math.cos(ang)*(radius-12), y2 = Math.sin(ang)*(radius-12);
    gctx.beginPath(); gctx.moveTo(x1,y1); gctx.lineTo(x2,y2);
    gctx.strokeStyle = i<7?"#a7bdd8": (i<9?"#f0c76b":"#ff7a7a");
    gctx.lineWidth = 3; gctx.stroke();
  }
  gctx.fillStyle="#0d2a4d"; gctx.font="700 28px system-ui"; gctx.textAlign="center";
  gctx.fillText("Geiger Counter", 0, -radius-18);
  gctx.font="600 18px system-ui"; gctx.fillStyle="#2a7de1"; gctx.fillText("counts/sec (simulated)", 0, -radius+4);
  const t = Math.max(0, Math.min(1, value));
  const ang = start + (end-start)*t;
  gctx.rotate(ang);
  gctx.beginPath(); gctx.moveTo(-6, 12); gctx.lineTo(0, -radius+18); gctx.lineTo(6, 12);
  gctx.closePath(); gctx.fillStyle="#2dd4bf"; gctx.fill();
  gctx.restore();
  gctx.fillStyle="#0b2747"; gctx.font="800 34px system-ui"; gctx.textAlign="right";
  gctx.fillText((geigerRate|0) + " cps", w-24, h-20);
}

function generateFloorTexture(){
  const c = document.createElement('canvas'); c.width=256; c.height=256;
  const ctx = c.getContext('2d');
  ctx.fillStyle="#f4f8fd"; ctx.fillRect(0,0,256,256);
  for(let y=0;y<16;y++) for(let x=0;x<24;x++){
    const v = (x+y)%2 ? 230: 240; ctx.fillStyle = `rgb(${v},${v+3},${v+8})`; ctx.fillRect(x*10,y*16,10,16);
  }
  for(let i=0;i<500;i++){ const x=Math.random()*256, y=Math.random()*256, a=Math.random()*0.12; ctx.fillStyle=`rgba(90,120,150,${a})`; ctx.fillRect(x,y,1,1); }
  return c;
}

// ==============================
// Audio clicks (Poisson)
// ==============================
const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
let clicksPaused = true, clickTimer = null;

function playClick(){
  const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type="square"; o.frequency.value = 900 + Math.random()*150;
  g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.03);
  o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.04);
}

function scheduleNextClick(){
  if (clicksPaused) return;
  const rate = Math.max(0.01, geigerRate);
  const u = Math.random(); const dt = -Math.log(1-u) / rate;
  clickTimer = setTimeout(()=>{ playClick(); scheduleNextClick(); }, dt*1000);
}

function resumeClicks(){ clicksPaused=false; if (audioCtx.state==='suspended') audioCtx.resume(); clearTimeout(clickTimer); scheduleNextClick(); }
function pauseClicks(){ clicksPaused=true; clearTimeout(clickTimer); }

// ==============================
// HUD
// ==============================
function setStatus(msg){
  if (!statusMsg) return;
  statusMsg.textContent = msg;
  statusMsg.style.opacity = 1;
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(()=>{ statusMsg.style.opacity = 0.8; }, 1600);
}

// ==============================
// Main loop
// ==============================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  const fwd = new THREE.Vector3(); controls.getDirection(fwd); fwd.y=0; fwd.normalize();
  const right = new THREE.Vector3().copy(fwd).cross(new THREE.Vector3(0,1,0)).normalize();

  const v = speed * (1 + sprintBoost * sprint);
  const move = new THREE.Vector3()
    .addScaledVector(fwd,   (moveF - moveB) * v * dt)
    .addScaledVector(right, (moveR - moveL) * v * dt);

  const next = controls.object.position.clone().add(move); next.y = 1.6;
  resolveCollisions(next); controls.object.position.copy(next); camera.position.copy(next);

  const raw = intensityAt(camera.position);
  const cps = 6 + raw * 0.28 + (Math.random()*2-1)*0.6; geigerRate = Math.max(0, cps);
  const gaugeMax = 220; const target = Math.min(1, geigerRate / gaugeMax);
  smoothed += (target - smoothed) * (1 - Math.pow(0.04, dt*60));
  drawGauge(smoothed);

  const rn = document.getElementById('roomName'); rn && (rn.textContent = currentRoomName(camera.position.x, camera.position.z));

  renderer.render(scene, camera);
}

// ==============================
// Built-in layout (kept as option)
// ==============================
function buildBuiltinLayout(){
  // Outer boundary
  addWallBox(0, 1.5, -24, 80, 3, 0.5); // south
  addWallBox(0, 1.5,  24, 80, 3, 0.5); // north
  addWallBox(-40, 1.5, 0, 0.5, 3, 48); // west
  addWallBox( 40, 1.5, 0, 0.5, 3, 48); // east
  // a corridor rect so contamination can spawn there too
  window.__builtinCorridorRect = { name: 'Main Corridor', x1: -38, z1: -4, x2: 38, z2: 4 };
  // Start in the main corridor
setSpawnInsideRect(window.__builtinCorridorRect);


  // TOP row (north)
  addRoom("Waste Room",    -38,  6, -28, 23, "south"); addWallSign("Waste Room", -33, 6.0, "south");
  addRoom("Break Room",    -26,  6, -16, 23, "south"); addWallSign("Break Room", -21, 6.0, "south");
  addRoom("Camera Room 1",  -4,  6,  16, 23, "south"); addWallSign("Camera Room 1", 6, 6.0, "south");
  addRoom("Injection Room",  0,  6, 10, 12, "south"); addWallSign("Injection Room", 5, 6.0, "south");
  addRoom("Camera Room 2",  24,  6,  38, 23, "south"); addWallSign("Camera Room 2", 31, 6.0, "south");

  // BOTTOM row (south)
  addRoom("Waiting Area",  -40, -23, -18, -6, "north"); addWallSign("Waiting Area", -29, -6.0, "north");
  addRoom("Reception",     -40, -35, -26, -23, "north"); addWallSign("Reception", -33, -23.0, "north");
  addRoom("Clinic Room",   -18, -18, -10, -12, "north"); addWallSign("Clinic Room", -14, -12.0, "north");
  addRoom("Clinic Room",   -18, -11, -10,  -6, "north"); addWallSign("Clinic Room", -14, -6.0, "north");
  addRoom("Camera Room 4",  -6, -23,  10,  -8, "north"); addWallSign("Camera Room 4", 2, -8.0, "north");
  addRoom("Control Room",   12, -23,  20,  -8, "north"); addWallSign("Control Room", 16, -8.0, "north");
  addRoom("Camera Room 3",  22, -23,  38,  -8, "north"); addWallSign("Camera Room 3", 30, -8.0, "north");

  // Built-in props
  addDesk(-31, -18, 6, 1.8);
  addDesk(-14, -15, 3.5, 1.6);
  addDesk( 16, -16, 3.5, 1.6);
  for(let r=0;r<3;r++) for(let c=0;c<4;c++) addChair(-36 + c*2.0, -20 + r*2.2, Math.PI);
  addSymbiaCamera( 6, 14, Math.PI);
  addSymbiaCamera(31, 14, Math.PI);
  addSymbiaCamera(30,-16, 0);
  addSymbiaCamera( 2,-16, 0);
  wasteBags.push(addWasteBag(-36.5, 18.0), addWasteBag(-32.0, 18.5), addWasteBag(-34.0, 12.5));
  addPatient(-36, -12, Math.PI/2);
  addPatient(-32, -16, Math.PI/2);
  addPatient(-28, -10, Math.PI/2);
  addPatient(  8,  -2, 0);
  addPatient( 28,  -2, 0);
}

// ==============================
// Layout loader (JSON from editor)
// ==============================
function getLayoutUrl() {
  const u = new URL(location.href);
  const q = u.searchParams.get('layout');
  if (!q) return 'layout.json';               // default: try site-root layout.json
  if (q.toLowerCase()==='builtin') return null; // force built-in
  return q;                                    // e.g. layouts/mydept.json
}

async function loadAndBuildLayout(url = 'layout.json') {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`layout not found at ${url}`);
  const layout = await res.json();
  buildLayoutFromJson(layout);
}


function buildLayoutFromJson(layout){
  // extents
  const rects = [];
  (layout.rooms||[]).forEach(r=> rects.push({x1:Math.min(r.x1,r.x2), z1:Math.min(r.z1,r.z2), x2:Math.max(r.x1,r.x2), z2:Math.max(r.z1,r.z2)}));
  (layout.zones||[]).forEach(z=> rects.push({x1:Math.min(z.x1,z.x2), z1:Math.min(z.z1,z.z2), x2:Math.max(z.x1,z.x2), z2:Math.max(z.z1,z.z2)}));
  if (rects.length) {
    const ext = rects.reduce((a,b)=>({x1:Math.min(a.x1,b.x1),z1:Math.min(a.z1,b.z1),x2:Math.max(a.x2,b.x2),z2:Math.max(a.z2,b.z2)}));
    addWallBox((ext.x1+ext.x2)/2, 1.5, ext.z1, Math.abs(ext.x2-ext.x1), 3, 0.5);
    addWallBox((ext.x1+ext.x2)/2, 1.5, ext.z2, Math.abs(ext.x2-ext.x1), 3, 0.5);
    addWallBox(ext.x1, 1.5, (ext.z1+ext.z2)/2, 0.5, 3, Math.abs(ext.z2-ext.z1));
    addWallBox(ext.x2, 1.5, (ext.z1+ext.z2)/2, 0.5, 3, Math.abs(ext.z2-ext.z1));
  }
// Choose a spawn inside the layout:
// 1) a zone named like "corridor" / "reception" / "waiting" if present,
// 2) otherwise the largest zone,
// 3) otherwise the largest room,
// 4) fallback: overall extents center.
(function chooseSpawn(){
  const zones = (layout.zones || []).slice();
  const rooms = (layout.rooms || []).slice();

  const byAreaDesc = (a,b) => {
    const aa = Math.abs((a.x2 - a.x1) * (a.z2 - a.z1));
    const bb = Math.abs((b.x2 - b.x1) * (b.z2 - b.z1));
    return bb - aa;
  };

  let spawnRect = null;

  // Prefer specifically-named public areas
  const prefer = zones.find(z => /corridor|reception|waiting/i.test(z.name||''));
  if (prefer) spawnRect = prefer;

  // Next: biggest zone
  if (!spawnRect && zones.length) spawnRect = zones.sort(byAreaDesc)[0];

  // Next: biggest room
  if (!spawnRect && rooms.length) spawnRect = rooms.sort(byAreaDesc)[0];

  // Fallback: overall extents
  if (!spawnRect) spawnRect = ext;

  setSpawnInsideRect(spawnRect);
})();

  // rooms
  for (const r of (layout.rooms||[])) {
    const w = Math.abs(r.x2-r.x1), d = Math.abs(r.z2-r.z1);
    const side = r.door?.side || 'south';
    const width= r.door?.width || 2.4;
    let centerOff = 0;
    if (side==='south'||side==='north') centerOff = ((r.door?.pos ?? 0.5) - 0.5) * w;
    else                                centerOff = ((r.door?.pos ?? 0.5) - 0.5) * d;
    addRoom(r.name||'Room', r.x1, r.z1, r.x2, r.z2, side, centerOff, width, 3);

    const cx = (r.x1+r.x2)/2, cz=(r.z1+r.z2)/2;
    if (side==='south') addWallSign(r.name||'Room', cx, r.z1, 'south');
    if (side==='north') addWallSign(r.name||'Room', cx, r.z2, 'north');
    if (side==='west')  addWallSign(r.name||'Room', r.x1, cz, 'west');
    if (side==='east')  addWallSign(r.name||'Room', r.x2, cz, 'east');
  }

  // props
  for (const p of (layout.props||[])) {
    if (p.type==='camera') addSymbiaCamera(p.x, p.z, p.rot||0);
    if (p.type==='wasteBag') wasteBags.push(addWasteBag(p.x, p.z));
    if (p.type==='chair') addChair(p.x, p.z, p.rot||0);
    if (p.type==='desk') addDesk(p.x, p.z);
    if (p.type==='patientSpawn') addPatient(p.x, p.z, p.rot||0);
  }

  // spawn areas
  window.__spawnAreas = (layout.rooms||[]).concat(layout.zones||[]).map(a => ({
    name: a.name || 'Area', x1:a.x1, z1:a.z1, x2:a.x2, z2:a.z2
  }));
}

function getOverallExtents(){
  let ext=null;
  for (const r of roomBounds){
    ext = ext ? {
      x1:Math.min(ext.x1,r.x1), z1:Math.min(ext.z1,r.z1),
      x2:Math.max(ext.x2,r.x2), z2:Math.max(ext.z2,r.z2)
    } : {x1:r.x1,z1:r.z1,x2:r.x2,z2:r.z2};
  }
  if (!ext) ext = {x1:-10,z1:-10,x2:10,z2:10};
  return ext;
}

// ==============================
// Boot
// ==============================
(async () => {
  const layoutUrl = getLayoutUrl();
  try {
    if (layoutUrl) {
      await loadAndBuildLayout(layoutUrl);
      console.log(`📐 Loaded layout from ${layoutUrl}`);
    } else {
      console.log('📐 Using built-in layout (forced by ?layout=builtin)');
      buildBuiltinLayout();
    }
  } catch (e) {
    console.warn(`No layout at "${layoutUrl}". Falling back to built-in.`, e);
    buildBuiltinLayout();
  }
  seedScenario();
  animate();
})();




