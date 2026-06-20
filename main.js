import * as THREE from 'three';

// ============================================================================
// GLOBAL STATE
// ============================================================================
let scene, camera, renderer, clock;
let perspCamera, orthoCamera;
let projectionMode = 'perspective'; // 'perspective' | 'orthographic'
let raycaster = new THREE.Raycaster();

let mouse = new THREE.Vector2();
let mouseScreen = new THREE.Vector2();
let keys = {};

// Selection mode: 'vertex' | 'edge' | 'face'
let selectMode = 'vertex';

// Active tool: 'idle' | 'grab' | 'rotate' | 'scale' | 'box'
let activeTool = 'idle';
let axisLock = null; // null | 'x' | 'y' | 'z'

// Selection state
let selectedIds = new Set(); // vertex ids
let hoveredId = null;

// Reference images
let referenceImages = []; // { imageId, plane, corners:[{pos, handle}], group, opacity }
let hoveredRefCorner = null; // { imageId, cornerIndex }
let selectedRefCorners = new Set(); // Set of "imageId:cornerIndex" strings
let transformRefCorners = []; // [{imageId, cornerIndex, pos}, ...]

// Transform state
let transformStartPositions = [];
let transformCentroid = new THREE.Vector3();
let transformStartMouse = new THREE.Vector2();

// 3D Cursor
let cursor3D = null;
let cursor3DPos = new THREE.Vector3(0, 0, 0);

// Navigation
let isOrbiting = false, isPanning = false;
let isOrthoPanning = false; // Shift+Middle drag in orthographic = pan the 2D view
let moveCursorDuringDrag = false;
let prevMouse = new THREE.Vector2();
let orbitTheta = Math.PI / 3, orbitPhi = Math.PI / 4;
let orbitRadius = 8;
let orbitTarget = new THREE.Vector3(0, 0, 0);

// Wireframe display mode
let wireframeMode = false;
let xMarkerGroup = null;

// Knife tool state
let knifeChain = []; // ordered vertex ids created/used by current knife cut
let knifePreview = null; // THREE.Line preview of cut so far

// Box select
let boxSelectActive = false;
let boxStart = new THREE.Vector2();
let boxEnd = new THREE.Vector2();

// Axis constraint line
let axisLine = null;

// Undo system
let undoStack = [];

function snapshotTopology() {
  return {
    verts: topo.verts.map(v => ({ id: v.id, pos: v.pos.clone() })),
    edges: topo.edges.map(e => ({ id: e.id, v1: e.v1, v2: e.v2, faceIds: [...e.faceIds] })),
    faces: topo.faces.map(f => ({ id: f.id, vIds: [...f.vIds], eIds: [...f.eIds] })),
    nextId: topo.nextId,
    selectedIds: new Set(selectedIds),
  };
}

function restoreSnapshot(snap) {
  topo.verts.forEach(v => { if (v.mesh.geometry) v.mesh.geometry.dispose(); if (v.mesh.material) v.mesh.material.dispose(); topo.vGroup.remove(v.mesh); });
  topo.edges.forEach(e => { if (e.line.geometry) e.line.geometry.dispose(); if (e.line.material) e.line.material.dispose(); topo.eGroup.remove(e.line); });
  topo.faces.forEach(f => { if (f.mesh.geometry) f.mesh.geometry.dispose(); if (f.mesh.material) f.mesh.material.dispose(); topo.fGroup.remove(f.mesh); });
  topo.verts = []; topo.edges = []; topo.faces = [];
  snap.verts.forEach(vd => { const m = new THREE.Mesh(topo.vGeo, topo.vMatDef.clone()); m.position.copy(vd.pos); topo.vGroup.add(m); topo.verts.push({ id: vd.id, pos: vd.pos.clone(), mesh: m }); });
  snap.edges.forEach(ed => { const a = topo.getV(ed.v1), b = topo.getV(ed.v2); if (!a || !b) return; const g = new THREE.BufferGeometry().setFromPoints([a.pos.clone(), b.pos.clone()]); const l = new THREE.Line(g, topo.eMatDef.clone()); topo.eGroup.add(l); topo.edges.push({ id: ed.id, v1: ed.v1, v2: ed.v2, line: l, faceIds: [...ed.faceIds] }); });
  snap.faces.forEach(fd => { const ps = fd.vIds.map(id => topo.getV(id).pos); const g = new THREE.BufferGeometry(); const verts = new Float32Array(ps.flatMap(p => [p.x, p.y, p.z])); g.setAttribute('position', new THREE.BufferAttribute(verts, 3)); g.setIndex(ps.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]); g.computeVertexNormals(); const m = new THREE.Mesh(g, faceMatDefault.clone()); topo.fGroup.add(m); topo.faces.push({ id: fd.id, vIds: [...fd.vIds], eIds: [...fd.eIds], mesh: m }); });
  topo.nextId = snap.nextId;
  selectedIds = new Set(snap.selectedIds);
  updateAllColors();
  updateHUD();
}

function pushUndo() { undoStack.push(snapshotTopology()); if (undoStack.length > 50) undoStack.shift(); }
function undo() { if (undoStack.length === 0) return; restoreSnapshot(undoStack.pop()); }

// ============================================================================
// COLORS
// ============================================================================
const C = {
  faceDefault: 0x3a6ea5, faceHover: 0x5a9ed5, faceSelected: 0xe67e22,
  edgeDefault: 0x88aacc, edgeHover: 0xffff00, edgeSelected: 0xff6600,
  vertDefault: 0xffffff, vertHover: 0xffff00, vertSelected: 0xff3300,
  refCornerDefault: 0xffffff, refCornerHover: 0xffff00, refCornerSelected: 0xff3300,
  cursor: 0xffffff, cursorRing: 0xff0000,
  axisX: 0xff0000, axisY: 0x00ff00, axisZ: 0x0000ff,
};

const faceMatDefault = new THREE.MeshStandardMaterial({ color: C.faceDefault, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.85 });
const faceMatHover = faceMatDefault.clone(); faceMatHover.color.set(C.faceHover);
const faceMatSelected = faceMatDefault.clone(); faceMatSelected.color.set(C.faceSelected);

const refCornerGeo = new THREE.SphereGeometry(0.06, 8, 8);
const refCornerMatDef = new THREE.MeshBasicMaterial({ color: C.refCornerDefault });
const refCornerMatHov = new THREE.MeshBasicMaterial({ color: C.refCornerHover });
const refCornerMatSel = new THREE.MeshBasicMaterial({ color: C.refCornerSelected });

// ============================================================================
// TOPOLOGY
// ============================================================================
class Topology {
  constructor(scene) {
    this.scene = scene;
    this.verts = []; // {id, pos:Vector3, mesh:Mesh}
    this.edges = []; // {id, v1, v2, line:Line, faceIds:[]}
    this.faces = []; // {id, vIds:[], eIds:[], mesh:Mesh}
    this.nextId = 1;

    this.vGroup = new THREE.Group();
    this.eGroup = new THREE.Group();
    this.fGroup = new THREE.Group();
    scene.add(this.vGroup, this.eGroup, this.fGroup);

    this.vGeo = new THREE.SphereGeometry(0.06, 8, 8);
    this.vMatDef = new THREE.MeshBasicMaterial({ color: C.vertDefault });
    this.vMatHov = new THREE.MeshBasicMaterial({ color: C.vertHover });
    this.vMatSel = new THREE.MeshBasicMaterial({ color: C.vertSelected });
    this.eMatDef = new THREE.LineBasicMaterial({ color: C.edgeDefault });
    this.eMatHov = new THREE.LineBasicMaterial({ color: C.edgeHover });
    this.eMatSel = new THREE.LineBasicMaterial({ color: C.edgeSelected });
  }

  addV(p) {
    const m = new THREE.Mesh(this.vGeo, this.vMatDef.clone());
    m.position.copy(p);
    this.vGroup.add(m);
    const v = { id: this.nextId++, pos: p.clone(), mesh: m };
    this.verts.push(v);
    return v;
  }

  addE(v1, v2) {
    const ex = this.edges.find(e => (e.v1 === v1 && e.v2 === v2) || (e.v1 === v2 && e.v2 === v1));
    if (ex) return ex;
    const a = this.getV(v1), b = this.getV(v2);
    if (!a || !b) return null;
    const g = new THREE.BufferGeometry().setFromPoints([a.pos.clone(), b.pos.clone()]);
    const l = new THREE.Line(g, this.eMatDef.clone());
    this.eGroup.add(l);
    const e = { id: this.nextId++, v1, v2, line: l, faceIds: [] };
    this.edges.push(e);
    return e;
  }

  addF(vIds) {
    const eIds = vIds.map((_, i) => this.addE(vIds[i], vIds[(i + 1) % vIds.length]).id);
    const ps = vIds.map(id => this.getV(id).pos);
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(ps.flatMap(p => [p.x, p.y, p.z]));
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(ps.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, faceMatDefault.clone());
    this.fGroup.add(m);
    const f = { id: this.nextId++, vIds: [...vIds], eIds, mesh: m };
    this.faces.push(f);
    eIds.forEach(eid => { const e = this.getE(eid); if (e && !e.faceIds.includes(f.id)) e.faceIds.push(f.id); });
    return f;
  }

  getV(id) { return this.verts.find(v => v.id === id); }
  getE(id) { return this.edges.find(e => e.id === id); }
  getF(id) { return this.faces.find(f => f.id === id); }

  updateVGeo(id) {
    const v = this.getV(id); if (!v) return;
    v.mesh.position.copy(v.pos);
    this.edges.forEach(e => {
      if (e.v1 === id || e.v2 === id) {
        const a = this.getV(e.v1), b = this.getV(e.v2);
        e.line.geometry.setAttribute('position', new THREE.BufferAttribute(
          new Float32Array([a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z]), 3));
      }
    });
    this.faces.forEach(f => {
      if (f.vIds.includes(id)) {
        const ps = f.vIds.map(i => this.getV(i).pos);
        const arr = f.mesh.geometry.attributes.position.array;
        for (let i = 0; i < ps.length; i++) { arr[i * 3] = ps[i].x; arr[i * 3 + 1] = ps[i].y; arr[i * 3 + 2] = ps[i].z; }
        f.mesh.geometry.attributes.position.needsUpdate = true;
        f.mesh.geometry.computeVertexNormals();
      }
    });
  }

  moveV(id, np) { const v = this.getV(id); if (v) { v.pos.copy(np); this.updateVGeo(id); } }

  removeF(id) {
    const f = this.getF(id); if (!f) return;
    f.eIds.forEach(eid => { const e = this.getE(eid); if (e) { e.faceIds = e.faceIds.filter(x => x !== id); if (e.faceIds.length === 0) this.removeE(eid); } });
    if (f.mesh.geometry) f.mesh.geometry.dispose();
    if (f.mesh.material) f.mesh.material.dispose();
    this.fGroup.remove(f.mesh);
    this.faces = this.faces.filter(x => x.id !== id);
    this.cleanOrphans();
  }

  removeE(id) {
    const e = this.getE(id); if (!e) return;
    if (e.line.geometry) e.line.geometry.dispose();
    if (e.line.material) e.line.material.dispose();
    this.eGroup.remove(e.line);
    this.edges = this.edges.filter(x => x.id !== id);
  }

  removeV(id) {
    this.edges.filter(e => e.v1 === id || e.v2 === id).forEach(e => this.removeE(e.id));
    this.faces.filter(f => f.vIds.includes(id)).forEach(f => this.removeF(f.id));
    const v = this.getV(id);
    if (v) { if (v.mesh.geometry) v.mesh.geometry.dispose(); if (v.mesh.material) v.mesh.material.dispose(); this.vGroup.remove(v.mesh); this.verts = this.verts.filter(x => x.id !== id); }
  }

  cleanOrphans() {
    const used = new Set();
    this.edges.forEach(e => { used.add(e.v1); used.add(e.v2); });
    this.verts.filter(v => !used.has(v.id)).forEach(v => { if (v.mesh.geometry) v.mesh.geometry.dispose(); if (v.mesh.material) v.mesh.material.dispose(); this.vGroup.remove(v.mesh); });
    this.verts = this.verts.filter(v => used.has(v.id));
  }

  setVMat(id, m) { const v = this.getV(id); if (v) { if (v.mesh.material) v.mesh.material.dispose(); v.mesh.material = m.clone(); } }
  setEMat(id, m) { const e = this.getE(id); if (e) { if (e.line.material) e.line.material.dispose(); e.line.material = m.clone(); } }
  setFMat(id, m) { const f = this.getF(id); if (f) { if (f.mesh.material) f.mesh.material.dispose(); f.mesh.material = m.clone(); } }

  centroid(ids) {
    const c = new THREE.Vector3(); let n = 0;
    ids.forEach(id => { const v = this.getV(id); if (v) { c.add(v.pos); n++; } });
    return n > 0 ? c.divideScalar(n) : c;
  }

  edgeOutward(eid) {
    const e = this.getE(eid); if (!e) return new THREE.Vector3(1, 0, 0);
    const v1 = this.getV(e.v1), v2 = this.getV(e.v2);
    if (!v1 || !v2) return new THREE.Vector3(1, 0, 0);
    if (e.faceIds.length === 0) { const d = new THREE.Vector3().subVectors(v2.pos, v1.pos).normalize(); return new THREE.Vector3(-d.z, 0, d.x).normalize(); }
    const f = this.getF(e.faceIds[0]);
    const fv = f.vIds.map(id => this.getV(id).pos);
    const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(fv[1], fv[0]), new THREE.Vector3().subVectors(fv[2], fv[0])).normalize();
    const ed = new THREE.Vector3().subVectors(v2.pos, v1.pos).normalize();
    const out = new THREE.Vector3().crossVectors(fn, ed).normalize();
    const fc = new THREE.Vector3(); fv.forEach(v => fc.add(v)); fc.divideScalar(fv.length);
    const em = new THREE.Vector3().addVectors(v1.pos, v2.pos).multiplyScalar(0.5);
    if (out.dot(new THREE.Vector3().subVectors(fc, em)) > 0) out.negate();
    return out;
  }

  // Rebuild a face's edge list and rendered geometry from its current vIds loop
  rebuildFace(f) {
    f.eIds = f.vIds.map((_, i) => this.addE(f.vIds[i], f.vIds[(i + 1) % f.vIds.length]).id);
    f.eIds.forEach(eid => { const e = this.getE(eid); if (e && !e.faceIds.includes(f.id)) e.faceIds.push(f.id); });
    const ps = f.vIds.map(id => this.getV(id).pos);
    if (f.mesh.geometry) f.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ps.flatMap(p => [p.x, p.y, p.z])), 3));
    g.setIndex(fanIndex(ps.length));
    g.computeVertexNormals();
    f.mesh.geometry = g;
  }

  // Insert a new vertex at `point` splitting edge `eid`, updating any adjacent faces.
  splitEdgeAt(eid, point) {
    const e = this.getE(eid); if (!e) return null;
    const v1 = e.v1, v2 = e.v2;
    const adjFaces = [...e.faceIds];
    const nv = this.addV(point);
    this.removeE(eid);
    this.addE(v1, nv.id);
    this.addE(nv.id, v2);
    adjFaces.forEach(fid => {
      const f = this.getF(fid); if (!f) return;
      let insertAt = -1;
      for (let i = 0; i < f.vIds.length; i++) {
        const cur = f.vIds[i], nxt = f.vIds[(i + 1) % f.vIds.length];
        if ((cur === v1 && nxt === v2) || (cur === v2 && nxt === v1)) { insertAt = i + 1; break; }
      }
      if (insertAt >= 0) { f.vIds.splice(insertAt, 0, nv.id); this.rebuildFace(f); }
    });
    return nv;
  }

  // Split a face into two along the segment between two of its boundary verts
  splitFace(fid, vA, vB) {
    const f = this.getF(fid); if (!f) return;
    const i = f.vIds.indexOf(vA), j = f.vIds.indexOf(vB);
    if (i < 0 || j < 0 || i === j) return;
    const lo = Math.min(i, j), hi = Math.max(i, j);
    const loop1 = f.vIds.slice(lo, hi + 1);
    const loop2 = f.vIds.slice(hi).concat(f.vIds.slice(0, lo + 1));
    this.removeF(fid);
    if (loop1.length >= 3) this.addF(loop1);
    if (loop2.length >= 3) this.addF(loop2);
  }

  // Find a face whose boundary loop contains both vertex ids
  faceContaining(vA, vB) {
    return this.faces.find(f => f.vIds.includes(vA) && f.vIds.includes(vB));
  }
}

// Fan triangulation index for an n-gon: [0,1,2, 0,2,3, ...]
function fanIndex(n) {
  const idx = [];
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  return idx;
}

let topo;

// ============================================================================
// INIT
// ============================================================================
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.add(new THREE.GridHelper(20, 20, 0x446688, 0x223344));
  addGridLabels();

  const aspect = window.innerWidth / window.innerHeight;
  perspCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 200);
  orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  camera = perspCamera;
  updateCameraOrbit();


  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(5, 12, 8); scene.add(dl);
  scene.add(new THREE.HemisphereLight(0x88aacc, 0x444444, 0.5));

  clock = new THREE.Clock();
  topo = new Topology(scene);

  const v1 = topo.addV(new THREE.Vector3(-0.5, 0, -0.5));
  const v2 = topo.addV(new THREE.Vector3(0.5, 0, -0.5));
  const v3 = topo.addV(new THREE.Vector3(0.5, 0, 0.5));
  const v4 = topo.addV(new THREE.Vector3(-0.5, 0, 0.5));
  topo.addF([v1.id, v2.id, v3.id, v4.id]);

  setCursor3D(new THREE.Vector3(0, 0, 0));

  setupEvents();
  setupRefSystem();
  setupContextMenu();
  setupGizmo();
  document.getElementById('wireframe-btn')?.addEventListener('click', toggleWireframe);

  updateHUD();
  console.log('[INIT] Ready. V:', topo.verts.length, 'E:', topo.edges.length, 'F:', topo.faces.length);
}

// ============================================================================
// EVENTS
// ============================================================================
function setupEvents() {
  const c = renderer.domElement;
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
  c.addEventListener('mousedown', onMouseDown);
  c.addEventListener('mousemove', onMouseMove);
  c.addEventListener('mouseup', onMouseUp);
  c.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);
  document.getElementById('export-btn')?.addEventListener('click', exportGLB);
}

// ============================================================================
// REFERENCE IMAGE SYSTEM
// ============================================================================
function setupRefSystem() {
  const importBtn = document.getElementById('import-ref-btn');
  const fileInput = document.getElementById('ref-image-input');
  const meshSlider = document.getElementById('mesh-opacity-slider');
  const meshVal = document.getElementById('mesh-opacity-val');
  const imageSlider = document.getElementById('image-opacity-slider');
  const imageVal = document.getElementById('image-opacity-val');

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      importReferenceImage(file);
      fileInput.value = '';
    });
  }

  if (meshSlider && meshVal) {
    meshSlider.addEventListener('input', () => {
      const val = parseInt(meshSlider.value);
      meshVal.textContent = val + '%';
      const op = val / 100;
      topo.faces.forEach(f => {
        if (f.mesh.material) f.mesh.material.opacity = op;
      });
      faceMatDefault.opacity = op;
      faceMatHover.opacity = op;
      faceMatSelected.opacity = op;
    });
  }

  if (imageSlider && imageVal) {
    imageSlider.addEventListener('input', () => {
      const val = parseInt(imageSlider.value);
      imageVal.textContent = val + '%';
      const op = val / 100;
      referenceImages.forEach(ref => {
        ref.opacity = op;
        ref.plane.material.opacity = op;
      });
    });
  }
}

function importReferenceImage(file) {
  if (!file || (!file.name.toLowerCase().endsWith('.png') && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg'))) {
    alert('Please select a .png or .jpg file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => createReferenceImage(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function createReferenceImage(img) {
  const imageId = (referenceImages.length > 0 ? Math.max(...referenceImages.map(r => r.imageId)) : 0) + 1;

  const texture = new THREE.Texture(img);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // Size based on aspect ratio, default width ~3 units
  const aspect = img.width / Math.max(img.height, 1);
  const refWidth = 3;
  const refHeight = refWidth / aspect;
  const hw = refWidth / 2;
  const hh = refHeight / 2;

  const center = cursor3DPos.clone();
  const corners = [
    { pos: new THREE.Vector3(center.x - hw, center.y, center.z - hh), handle: null },
    { pos: new THREE.Vector3(center.x + hw, center.y, center.z - hh), handle: null },
    { pos: new THREE.Vector3(center.x + hw, center.y, center.z + hh), handle: null },
    { pos: new THREE.Vector3(center.x - hw, center.y, center.z + hh), handle: null },
  ];

  const positions = new Float32Array([
    corners[0].pos.x, corners[0].pos.y, corners[0].pos.z,
    corners[1].pos.x, corners[1].pos.y, corners[1].pos.z,
    corners[2].pos.x, corners[2].pos.y, corners[2].pos.z,
    corners[3].pos.x, corners[3].pos.y, corners[3].pos.z,
  ]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: parseInt(document.getElementById('image-opacity-slider')?.value || 100) / 100,
    depthTest: true,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(geo, mat);

  const group = new THREE.Group();
  group.add(plane);

  corners.forEach((c) => {
    const handle = new THREE.Mesh(refCornerGeo, refCornerMatDef.clone());
    handle.position.copy(c.pos);
    c.handle = handle;
    group.add(handle);
  });

  scene.add(group);

  referenceImages.push({
    imageId,
    plane,
    corners,
    group,
    opacity: parseInt(document.getElementById('image-opacity-slider')?.value || 100) / 100,
  });

  console.log(`[REF] Imported reference image ${imageId} — ${img.width}x${img.height}`);
}

function updateRefPlaneGeometry(ref) {
  const posArr = ref.plane.geometry.attributes.position.array;
  for (let i = 0; i < 4; i++) {
    const p = ref.corners[i].pos;
    posArr[i * 3] = p.x;
    posArr[i * 3 + 1] = p.y;
    posArr[i * 3 + 2] = p.z;
  }
  ref.plane.geometry.attributes.position.needsUpdate = true;
  ref.plane.geometry.computeVertexNormals();
}

function moveRefCorner(imageId, cornerIndex, newPos) {
  const ref = referenceImages.find(r => r.imageId === imageId);
  if (!ref) return;
  ref.corners[cornerIndex].pos.copy(newPos);
  ref.corners[cornerIndex].handle.position.copy(newPos);
  updateRefPlaneGeometry(ref);
}

// ============================================================================
// KEYBOARD
// ============================================================================
function onKey(e) {
  const k = e.key.toLowerCase();
  keys[k] = true;

  // Selection mode
  if (k === '1') { selectMode = 'vertex'; selectedIds.clear(); selectedRefCorners.clear(); updateAllColors(); updateHUD(); }
  if (k === '2') { selectMode = 'edge'; selectedIds.clear(); selectedRefCorners.clear(); updateAllColors(); updateHUD(); }
  if (k === '3') { selectMode = 'face'; selectedIds.clear(); selectedRefCorners.clear(); updateAllColors(); updateHUD(); }

  // Select all
  if (k === 'a') { selectAll(); e.preventDefault(); }

  // Box select
  if (k === 'b') { startBoxSelect(); e.preventDefault(); }

  // Wireframe display toggle
  if (k === '4') { toggleWireframe(); e.preventDefault(); }

  // Projection toggle (perspective <-> orthographic), Blender-style Numpad 5
  if (k === '5') { toggleProjection(); e.preventDefault(); }


  // Transform
  if (k === 'g' && activeTool === 'idle') { startTransform('grab'); e.preventDefault(); }
  if (k === 'r' && activeTool === 'idle') { startTransform('rotate'); e.preventDefault(); }
  if (k === 's' && activeTool === 'idle') { startTransform('scale'); e.preventDefault(); }

  // Axis lock during transform
  if (activeTool !== 'idle' && activeTool !== 'box' && activeTool !== 'knife') {
    if (k === 'x') { axisLock = 'x'; showAxisLine(); updateHUD(); }
    if (k === 'y') { axisLock = 'y'; showAxisLine(); updateHUD(); }
    if (k === 'z') { axisLock = 'z'; showAxisLine(); updateHUD(); }
  }

  // Knife tool (cut new geometry)
  if (k === 'k' && activeTool === 'idle') { startKnife(); e.preventDefault(); }
  if ((e.key === 'Enter' || (k === 'k' && activeTool === 'knife')) && activeTool === 'knife') { finishKnife(); e.preventDefault(); }

  // Subdivide selected edges/faces (add more geometry)
  if (k === 'w' && activeTool === 'idle') { pushUndo(); subdivideSelected(); e.preventDefault(); }

  // Modeling tools
  if (k === 'e' && !e.ctrlKey && activeTool === 'idle') { pushUndo(); doExtrude(); e.preventDefault(); }
  if (k === 'f' && activeTool === 'idle') { pushUndo(); doFill(); e.preventDefault(); }
  if (k === 'm' && activeTool === 'idle') { pushUndo(); doMerge(); e.preventDefault(); }
  if (k === 'x' && activeTool === 'idle') { pushUndo(); doDelete(); e.preventDefault(); }
  if (k === 'z' && e.ctrlKey) { undo(); e.preventDefault(); }

  // Cancel
  if (e.key === 'Escape') {
    if (activeTool === 'knife') finishKnife();
    else cancelTransform();
    e.preventDefault();
  }

  // Export
  if (k === 'e' && e.ctrlKey) { exportGLB(); e.preventDefault(); }
}

function updateMousePosition(e) {
  mouseScreen.set(e.clientX, e.clientY);
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function onMouseDown(e) {
  e.preventDefault();
  updateMousePosition(e);

  if (e.button === 0) { // Left
    if (activeTool === 'knife') { knifeClick(); return; }
    if (activeTool === 'box') { finishBoxSelect(); return; }
    if (activeTool !== 'idle') { confirmTransform(); return; }
    // Shift+Left-click on empty space places the 3D cursor (camera orbit pivot)
    if (e.shiftKey && !getHovered()) { placeCursor3D(); return; }
    // Left-click select
    doSelect(e.shiftKey);
  }

  if (e.button === 1) { // Middle
    if (e.shiftKey) {
      if (projectionMode === 'orthographic') {
        // Orthographic: Shift+Middle-drag pans the flat 2D view. The 3D cursor
        // rides along with the camera, staying pinned at the center of the view
        // (the orbit pivot) on the axis you are looking down — so you can then
        // Middle-drag to rotate/orbit around that re-centered point.
        isOrthoPanning = true;
        isPanning = false;
        isOrbiting = false;
        moveCursorDuringDrag = false;
        prevMouse.copy(mouseScreen);
      } else {
        // Perspective: Shift+Middle-drag slides the 3D cursor along surfaces.
        isOrthoPanning = false;
        isPanning = false;
        isOrbiting = false;
        moveCursorDuringDrag = true;
        prevMouse.copy(mouseScreen);
      }
    } else {
      isOrbiting = true;
      prevMouse.copy(mouseScreen);
    }
  }

  if (e.button === 2) { // Right
    if (e.shiftKey) { placeCursor3D(); }
    else if (activeTool === 'knife') { finishKnife(); }
    else if (activeTool !== 'idle') { cancelTransform(); }
    else { showContextMenu(e.clientX, e.clientY); }
  }
}

function onMouseMove(e) {
  updateMousePosition(e);

  if (isOrthoPanning) {
    // Pan the orthographic 2D view: convert the mouse pixel delta into world
    // units via the ortho frustum size and the camera's right/up vectors, then
    // shift the orbit pivot by that amount. updateCameraOrbit() moves the camera
    // along with the pivot, so the scene slides like a flat 2D image.
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    const wppX = (orthoCamera.right - orthoCamera.left) / window.innerWidth;
    const wppY = (orthoCamera.top - orthoCamera.bottom) / window.innerHeight;
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const move = new THREE.Vector3()
      .addScaledVector(camRight, -dx * wppX)
      .addScaledVector(camUp, dy * wppY);
    orbitTarget.add(move);
    updateCameraOrbit();
    // The 3D cursor rides along with the pan, staying pinned at the center of
    // the view (the orbit pivot) on the axis you are looking down — so you can
    // immediately Middle-drag to rotate around that re-centered point.
    cursor3DPos.copy(orbitTarget);
    if (cursor3D) cursor3D.position.copy(orbitTarget);
    prevMouse.copy(mouseScreen);
    return;
  }

  if (isOrbiting || isPanning) {
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    if (isOrbiting) {
      orbitPhi -= dx * 0.008;
      orbitTheta = Math.max(0.05, Math.min(Math.PI - 0.05, orbitTheta - dy * 0.008));
      // Orbit around current orbitTarget (don't snap back to cursor)
      updateCameraOrbit();
    }
    if (moveCursorDuringDrag) {
      // Move 3D cursor to mouse position on ground plane
      placeCursor3D();
    }
    if (isPanning) {
      const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
      const rt = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
      camera.position.addScaledVector(rt, -dx * 0.01);
      camera.position.addScaledVector(fw, dy * 0.01);
      orbitTarget.addScaledVector(rt, -dx * 0.01);
      orbitTarget.addScaledVector(fw, dy * 0.01);
      updateCameraOrbit();
    }
    prevMouse.copy(mouseScreen);
    return;
  }

  if (activeTool === 'box') { boxEnd.copy(mouseScreen); updateBoxOverlay(); return; }
  if (activeTool !== 'idle') { updateTransform(); return; }

  // Hover detection
  doHover();
}

function onMouseUp(e) {
  if (e.button === 1) { isOrbiting = false; isPanning = false; isOrthoPanning = false; moveCursorDuringDrag = false; }
  if (e.button === 0 && activeTool === 'box') { finishBoxSelect(); }
  // Hide box overlay when not box-selecting
  if (e.button === 0 && activeTool !== 'box') {
    const overlay = document.getElementById('box-select-overlay');
    if (overlay) overlay.style.display = 'none';
  }
}

function onWheel(e) {
  e.preventDefault();
  orbitRadius = Math.max(1, Math.min(50, orbitRadius + (e.deltaY > 0 ? 0.5 : -0.5)));
  updateCameraOrbit();
}

function onResize() {
  const aspect = window.innerWidth / window.innerHeight;
  perspCamera.aspect = aspect;
  perspCamera.updateProjectionMatrix();
  updateOrthoFrustum();
  renderer.setSize(window.innerWidth, window.innerHeight);
}


// ============================================================================
// CAMERA ORBIT
// ============================================================================
function updateCameraOrbit() {
  camera.position.set(
    orbitTarget.x + orbitRadius * Math.sin(orbitTheta) * Math.cos(orbitPhi),
    orbitTarget.y + orbitRadius * Math.cos(orbitTheta),
    orbitTarget.z + orbitRadius * Math.sin(orbitTheta) * Math.sin(orbitPhi)
  );
  camera.lookAt(orbitTarget);
  if (camera.isOrthographicCamera) updateOrthoFrustum();
}

// Size the orthographic frustum from the orbit radius so that "zoom" (scroll)
// and window resizes behave like the perspective camera.
function updateOrthoFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = orbitRadius * 0.5;
  const halfW = halfH * aspect;
  orthoCamera.left = -halfW;
  orthoCamera.right = halfW;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

// ============================================================================
// PROJECTION MODE (perspective <-> orthographic) + AXIS VIEW SNAPPING
// ============================================================================
function setProjectionMode(mode) {
  if (mode === projectionMode) return;
  projectionMode = mode;
  camera = (mode === 'orthographic') ? orthoCamera : perspCamera;
  // Keep the active camera in sync with the current viewport size + orbit.
  if (camera.isPerspectiveCamera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  updateCameraOrbit();
  updateProjButton();
}

function toggleProjection() {
  setProjectionMode(projectionMode === 'perspective' ? 'orthographic' : 'perspective');
}

function updateProjButton() {
  const btn = document.getElementById('proj-toggle');
  if (btn) btn.textContent = projectionMode === 'orthographic' ? 'Ortho' : 'Persp';
}

// Snap the camera to look straight down a world axis (flat 2D view) and switch
// to orthographic. Clicking the same axis again flips to the opposite side.
// This app is Y-up: X = side, Y = top, Z = front.
let lastSnapAxis = null;
let lastSnapSign = -1;
function snapToAxisView(axis) {
  let sign = 1;
  if (lastSnapAxis === axis) sign = -lastSnapSign;
  lastSnapAxis = axis;
  lastSnapSign = sign;

  const eps = 0.0001;
  if (axis === 'y') {
    // Top / bottom view (look straight down / up the vertical axis)
    orbitTheta = sign > 0 ? eps : Math.PI - eps;
    orbitPhi = -Math.PI / 2; // keep +Z pointing "down" on screen for a stable top view
  } else if (axis === 'x') {
    // Side view (camera on +/-X looking toward center)
    orbitTheta = Math.PI / 2;
    orbitPhi = sign > 0 ? 0 : Math.PI;
  } else if (axis === 'z') {
    // Front view (camera on +/-Z looking toward center)
    orbitTheta = Math.PI / 2;
    orbitPhi = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  setProjectionMode('orthographic');
  updateCameraOrbit();
}

// ============================================================================
// NAVIGATION GIZMO (Blender-style axis compass, top-right corner)
// Clicking a colored axis ball snaps to a flat orthographic view down that axis.
// ============================================================================
const GIZMO_AXES = [
  { axis: 'x', dir: new THREE.Vector3(1, 0, 0), sign: 1, color: '#ff5555', label: 'X' },
  { axis: 'x', dir: new THREE.Vector3(-1, 0, 0), sign: -1, color: '#ff5555', label: '' },
  { axis: 'y', dir: new THREE.Vector3(0, 1, 0), sign: 1, color: '#55dd55', label: 'Y' },
  { axis: 'y', dir: new THREE.Vector3(0, -1, 0), sign: -1, color: '#55dd55', label: '' },
  { axis: 'z', dir: new THREE.Vector3(0, 0, 1), sign: 1, color: '#5588ff', label: 'Z' },
  { axis: 'z', dir: new THREE.Vector3(0, 0, -1), sign: -1, color: '#5588ff', label: '' },
];
let gizmoBalls = [];

function setupGizmo() {
  const gizmo = document.getElementById('nav-gizmo');
  if (!gizmo) return;
  const R = 32;      // radius the axis balls swing around
  const cx = 44, cy = 44; // gizmo center (88px box)

  gizmoBalls = GIZMO_AXES.map((a, i) => {
    const el = document.createElement('div');
    el.className = 'gz-ball' + (a.sign > 0 ? ' gz-ball-pos' : ' gz-ball-neg');
    el.textContent = a.label;
    if (a.sign > 0) el.style.background = a.color;
    else { el.style.borderColor = a.color; }
    el.addEventListener('click', (ev) => { ev.stopPropagation(); snapToAxisView(a.axis); });
    gizmo.appendChild(el);
    return { ...a, el };
  });

  // Center toggle: switch perspective <-> orthographic
  const toggle = document.getElementById('proj-toggle');
  if (toggle) {
    toggle.addEventListener('click', (ev) => { ev.stopPropagation(); toggleProjection(); });
  }
  updateProjButton();

  gizmo._R = R; gizmo._cx = cx; gizmo._cy = cy;
}

function updateGizmo() {
  if (gizmoBalls.length === 0) return;
  const gizmo = document.getElementById('nav-gizmo');
  if (!gizmo) return;
  const R = gizmo._R, cx = gizmo._cx, cy = gizmo._cy;
  const invQ = camera.quaternion.clone().invert();
  // Sort by view-space depth so nearer balls render on top.
  const computed = gizmoBalls.map(b => {
    const v = b.dir.clone().applyQuaternion(invQ); // view space (camera looks down -Z)
    return { b, v };
  });
  computed.sort((p, q) => p.v.z - q.v.z); // smaller z (farther) first
  computed.forEach(({ b, v }, order) => {
    const x = cx + v.x * R;
    const y = cy - v.y * R;
    const front = v.z > -0.0001; // toward viewer
    b.el.style.left = (x - 9) + 'px';
    b.el.style.top = (y - 9) + 'px';
    b.el.style.zIndex = String(10 + order);
    b.el.style.opacity = front ? '1' : '0.45';
  });
}

// ============================================================================
// SELECTION
// ============================================================================

function getHovered() {
  raycaster.setFromCamera(mouse, camera);

  if (selectMode === 'face') {
    const meshes = topo.faces.map(f => f.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const idx = meshes.indexOf(hits[0].object);
      if (idx >= 0) return { type: 'face', id: topo.faces[idx].id };
    }
  }

  if (selectMode === 'edge') {
    // Check edges on hovered faces first
    const meshes = topo.faces.map(f => f.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const idx = meshes.indexOf(hits[0].object);
      if (idx >= 0) {
        const f = topo.faces[idx];
        let best = null, bestD = Infinity;
        f.eIds.forEach(eid => { const e = topo.getE(eid); if (!e) return; const d = distPtSeg(hits[0].point, topo.getV(e.v1).pos, topo.getV(e.v2).pos); if (d < bestD) { bestD = d; best = eid; } });
        if (best !== null && bestD < 0.3) return { type: 'edge', id: best };
      }
    }
    // Free edges — increased threshold
    let best = null, bestD = Infinity;
    topo.edges.forEach(e => { const d = distRaySeg(raycaster.ray.origin, raycaster.ray.direction, topo.getV(e.v1).pos, topo.getV(e.v2).pos); if (d < bestD) { bestD = d; best = e.id; } });
    if (best !== null && bestD < 0.3) return { type: 'edge', id: best };
  }

  if (selectMode === 'vertex') {
    // Use raycaster against vertex meshes first (more reliable than distance)
    const meshes = topo.verts.map(v => v.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const idx = meshes.indexOf(hits[0].object);
      if (idx >= 0) return { type: 'vertex', id: topo.verts[idx].id };
    }
    // Fallback: distance-based with larger threshold
    let best = null, bestD = Infinity;
    topo.verts.forEach(v => { const d = distRayPt(raycaster.ray.origin, raycaster.ray.direction, v.pos); if (d < bestD) { bestD = d; best = v.id; } });
    if (best !== null && bestD < 0.25) return { type: 'vertex', id: best };
    // Check reference image corners
    for (const ref of referenceImages) {
      for (let ci = 0; ci < ref.corners.length; ci++) {
        const ch = ref.corners[ci].handle;
        const chits = raycaster.intersectObject(ch, false);
        if (chits.length > 0) return { type: 'refCorner', imageId: ref.imageId, cornerIndex: ci };
      }
    }
    for (const ref of referenceImages) {
      for (let ci = 0; ci < ref.corners.length; ci++) {
        const d = distRayPt(raycaster.ray.origin, raycaster.ray.direction, ref.corners[ci].pos);
        if (d < 0.25) return { type: 'refCorner', imageId: ref.imageId, cornerIndex: ci };
      }
    }
  }

  return null;
}

function doHover() {
  // Clear old hover
  clearHoverVisual();
  hoveredId = null;
  hoveredRefCorner = null;

  const h = getHovered();
  if (!h) return;

  if (h.type === 'refCorner') {
    hoveredRefCorner = { imageId: h.imageId, cornerIndex: h.cornerIndex };
    const key = `${h.imageId}:${h.cornerIndex}`;
    if (!selectedRefCorners.has(key)) {
      const ref = referenceImages.find(r => r.imageId === h.imageId);
      if (ref) {
        ref.corners[h.cornerIndex].handle.material.dispose();
        ref.corners[h.cornerIndex].handle.material = refCornerMatHov.clone();
      }
    }
    return;
  }

  hoveredId = h.id;
  if (h.type === 'vertex' && !selectedIds.has(h.id)) topo.setVMat(h.id, topo.vMatHov);
  if (h.type === 'edge') {
    const e = topo.getE(h.id);
    if (e && !selectedIds.has(e.v1) && !selectedIds.has(e.v2)) topo.setEMat(h.id, topo.eMatHov);
  }
  if (h.type === 'face') {
    const f = topo.getF(h.id);
    if (f && !f.vIds.some(v => selectedIds.has(v))) topo.setFMat(h.id, faceMatHover);
  }
}

function clearHoverVisual() {
  if (hoveredRefCorner) {
    const ref = referenceImages.find(r => r.imageId === hoveredRefCorner.imageId);
    if (ref && ref.corners[hoveredRefCorner.cornerIndex]) {
      const ch = ref.corners[hoveredRefCorner.cornerIndex];
      const key = `${hoveredRefCorner.imageId}:${hoveredRefCorner.cornerIndex}`;
      ch.handle.material.dispose();
      ch.handle.material = selectedRefCorners.has(key) ? refCornerMatSel.clone() : refCornerMatDef.clone();
    }
  }
  if (hoveredId === null) return;
  // Restore all to default/selected state
  updateAllColors();
}

function doSelect(additive) {
  const h = getHovered();
  if (!h) {
    if (!additive) { selectedIds.clear(); selectedRefCorners.clear(); updateAllColors(); updateHUD(); }
    return;
  }

  if (h.type === 'refCorner') {
    const key = `${h.imageId}:${h.cornerIndex}`;
    if (selectedRefCorners.has(key)) {
      if (additive) selectedRefCorners.delete(key);
    } else {
      if (!additive) { selectedIds.clear(); selectedRefCorners.clear(); }
      selectedRefCorners.add(key);
    }
    updateAllColors();
    updateHUD();
    return;
  }

  // Deselect ref corners when selecting topology (unless additive)
  if (!additive) selectedRefCorners.clear();

  if (h.type === 'vertex') {
    if (selectedIds.has(h.id)) { if (additive) selectedIds.delete(h.id); }
    else { if (!additive) selectedIds.clear(); selectedIds.add(h.id); }
  } else if (h.type === 'edge') {
    const e = topo.getE(h.id);
    if (e) {
      const both = e.v1 === e.v2 || (selectedIds.has(e.v1) && selectedIds.has(e.v2));
      if (both && additive) { selectedIds.delete(e.v1); selectedIds.delete(e.v2); }
      else { if (!additive) selectedIds.clear(); selectedIds.add(e.v1); selectedIds.add(e.v2); }
    }
  } else if (h.type === 'face') {
    const f = topo.getF(h.id);
    if (f) {
      const all = f.vIds.every(v => selectedIds.has(v));
      if (all && additive) f.vIds.forEach(v => selectedIds.delete(v));
      else { if (!additive) selectedIds.clear(); f.vIds.forEach(v => selectedIds.add(v)); }
    }
  }
  updateAllColors();
  updateHUD();
}

function selectAll() {
  selectedRefCorners.clear();
  topo.verts.forEach(v => selectedIds.add(v.id));
  updateAllColors();
  updateHUD();
}

function startBoxSelect() {
  activeTool = 'box';
  boxStart.copy(mouseScreen);
  boxEnd.copy(mouseScreen);
  updateBoxOverlay();
  updateHUD();
}

function updateBoxOverlay() {
  const overlay = document.getElementById('box-select-overlay');
  if (!overlay) return;
  if (activeTool !== 'box') { overlay.style.display = 'none'; return; }
  const x1 = Math.min(boxStart.x, boxEnd.x);
  const y1 = Math.min(boxStart.y, boxEnd.y);
  const w = Math.abs(boxEnd.x - boxStart.x);
  const h = Math.abs(boxEnd.y - boxStart.y);
  overlay.style.display = 'block';
  overlay.style.left = x1 + 'px';
  overlay.style.top = y1 + 'px';
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';
}

function finishBoxSelect() {
  activeTool = 'idle';
  updateBoxOverlay();
  selectedRefCorners.clear();
  // Select all verts within box
  const x1 = Math.min(boxStart.x, boxEnd.x);
  const x2 = Math.max(boxStart.x, boxEnd.x);
  const y1 = Math.min(boxStart.y, boxEnd.y);
  const y2 = Math.max(boxStart.y, boxEnd.y);
  selectedIds.clear();
  topo.verts.forEach(v => {
    const sp = v.pos.clone().project(camera);
    const sx = (sp.x + 1) / 2 * window.innerWidth;
    const sy = (1 - sp.y) / 2 * window.innerHeight;
    if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) selectedIds.add(v.id);
  });
  updateAllColors();
  updateHUD();
}

function updateAllColors() {
  topo.verts.forEach(v => {
    if (selectedIds.has(v.id)) topo.setVMat(v.id, topo.vMatSel);
    else topo.setVMat(v.id, topo.vMatDef);
  });
  topo.edges.forEach(e => {
    if (selectedIds.has(e.v1) && selectedIds.has(e.v2)) topo.setEMat(e.id, topo.eMatSel);
    else topo.setEMat(e.id, topo.eMatDef);
  });
  topo.faces.forEach(f => {
    if (f.vIds.every(v => selectedIds.has(v))) topo.setFMat(f.id, faceMatSelected);
    else topo.setFMat(f.id, faceMatDefault);
  });
  // Reference image corner colors
  referenceImages.forEach(ref => {
    ref.corners.forEach((c, ci) => {
      const key = `${ref.imageId}:${ci}`;
      if (selectedRefCorners.has(key)) {
        c.handle.material.dispose();
        c.handle.material = refCornerMatSel.clone();
      } else if (hoveredRefCorner && hoveredRefCorner.imageId === ref.imageId && hoveredRefCorner.cornerIndex === ci) {
        c.handle.material.dispose();
        c.handle.material = refCornerMatHov.clone();
      } else {
        c.handle.material.dispose();
        c.handle.material = refCornerMatDef.clone();
      }
    });
  });
  // Keep wireframe X-markers in sync after any topology/selection change
  if (wireframeMode) updateWireframeMarkers();
}

// ============================================================================
// TRANSFORM
// ============================================================================
function startTransform(tool) {
  if (selectedIds.size === 0 && selectedRefCorners.size === 0) return;
  activeTool = tool;
  axisLock = null;
  transformStartMouse.copy(mouse);

  // Compute centroid from both topology and ref corners
  const allPts = [];
  [...selectedIds].forEach(id => { const v = topo.getV(id); if (v) allPts.push(v.pos.clone()); });
  selectedRefCorners.forEach(key => {
    const [imgId, ci] = key.split(':').map(Number);
    const ref = referenceImages.find(r => r.imageId === imgId);
    if (ref) allPts.push(ref.corners[ci].pos.clone());
  });
  transformCentroid = new THREE.Vector3();
  allPts.forEach(p => transformCentroid.add(p));
  if (allPts.length > 0) transformCentroid.divideScalar(allPts.length);

  transformStartPositions = [...selectedIds].map(id => ({ id, pos: topo.getV(id).pos.clone() }));
  transformRefCorners = [];
  selectedRefCorners.forEach(key => {
    const [imgId, ci] = key.split(':').map(Number);
    const ref = referenceImages.find(r => r.imageId === imgId);
    if (ref) transformRefCorners.push({ imageId: imgId, cornerIndex: ci, pos: ref.corners[ci].pos.clone() });
  });
  showAxisLine();
  updateHUD();
}

function updateTransform() {
  const planeNormal = new THREE.Vector3();
  if (activeTool === 'grab' && axisLock !== 'y') {
    // Default grab slides along the flat horizontal (XZ) ground plane so geometry
    // stays "flat 2D" against the reference image instead of drifting up/down.
    // Use axis lock Y (or Z) to deliberately move vertically.
    planeNormal.set(0, 1, 0);
  } else {
    camera.getWorldDirection(planeNormal);
    planeNormal.negate();
  }
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, transformCentroid);

  const ndcToPlane = (nx, ny) => {
    const ndc = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
    const dir = ndc.clone().sub(camera.position).normalize();
    const isect = new THREE.Vector3();
    return plane.intersectLine(new THREE.Line3(camera.position.clone(), camera.position.clone().add(dir)), isect) ? isect : null;
  };

  let sw = ndcToPlane(transformStartMouse.x, transformStartMouse.y);
  let ew = ndcToPlane(mouse.x, mouse.y);

  const applyToRefCorners = (fn) => {
    transformRefCorners.forEach(rc => {
      const r = referenceImages.find(ref => ref.imageId === rc.imageId);
      if (!r) return;
      const newPos = fn(rc.pos.clone());
      moveRefCorner(rc.imageId, rc.cornerIndex, newPos);
    });
  };

  // Fallback: if plane intersection fails, use camera right/up vectors
  if (!sw || !ew) {
    if (activeTool === 'grab') {
      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      camera.getWorldDirection(new THREE.Vector3()); // ensure matrix updated
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      const dxN = (mouse.x - transformStartMouse.x) * 5;
      const dyN = (mouse.y - transformStartMouse.y) * 5;
      let delta = new THREE.Vector3().addScaledVector(camRight, dxN).addScaledVector(camUp, dyN);
      if (axisLock === 'x') delta.set(delta.x, 0, 0);
      if (axisLock === 'y') delta.set(0, delta.y, 0);
      if (axisLock === 'z') delta.set(0, 0, delta.z);
      transformStartPositions.forEach(sp => topo.moveV(sp.id, sp.pos.clone().add(delta)));
      applyToRefCorners(sp => sp.clone().add(delta));
    } else if (activeTool === 'rotate') {
      // Rotate fallback: rotate around camera forward axis (pure 2D from viewer)
      const angle = (mouse.x - transformStartMouse.x) * 10;
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      camDir.normalize();
      const toO = new THREE.Matrix4().makeTranslation(-transformCentroid.x, -transformCentroid.y, -transformCentroid.z);
      const frO = new THREE.Matrix4().makeTranslation(transformCentroid.x, transformCentroid.y, transformCentroid.z);
      let tf = new THREE.Matrix4().multiply(frO).multiply(new THREE.Matrix4().makeRotationAxis(camDir, angle)).multiply(toO);
      transformStartPositions.forEach(sp => topo.moveV(sp.id, sp.pos.clone().applyMatrix4(tf)));
      applyToRefCorners(sp => sp.clone().applyMatrix4(tf));
    } else if (activeTool === 'scale') {
      const scl = Math.max(0.1, Math.min(5, 1 + (mouse.x - transformStartMouse.x) * 5));
      transformStartPositions.forEach(sp => {
        const rel = new THREE.Vector3().subVectors(sp.pos, transformCentroid).multiplyScalar(scl);
        topo.moveV(sp.id, new THREE.Vector3().copy(transformCentroid).add(rel));
      });
      applyToRefCorners(sp => {
        const rel = new THREE.Vector3().subVectors(sp, transformCentroid).multiplyScalar(scl);
        return new THREE.Vector3().copy(transformCentroid).add(rel);
      });
    }
    return;
  }

  if (activeTool === 'grab') {
    let delta = new THREE.Vector3().subVectors(ew, sw);
    if (axisLock === 'x') delta.set(delta.x, 0, 0);
    if (axisLock === 'y') delta.set(0, delta.y, 0);
    if (axisLock === 'z') delta.set(0, 0, delta.z);
    transformStartPositions.forEach(sp => topo.moveV(sp.id, sp.pos.clone().add(delta)));
    applyToRefCorners(sp => sp.clone().add(delta));
  } else if (activeTool === 'rotate') {
    // Rotate around camera forward axis only (pure 2D rotation from viewer perspective)
    const angle = (mouse.x - transformStartMouse.x) * 10;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.normalize();
    const toO = new THREE.Matrix4().makeTranslation(-transformCentroid.x, -transformCentroid.y, -transformCentroid.z);
    const frO = new THREE.Matrix4().makeTranslation(transformCentroid.x, transformCentroid.y, transformCentroid.z);
    let tf = new THREE.Matrix4().multiply(frO).multiply(new THREE.Matrix4().makeRotationAxis(camDir, angle)).multiply(toO);
    transformStartPositions.forEach(sp => topo.moveV(sp.id, sp.pos.clone().applyMatrix4(tf)));
    applyToRefCorners(sp => sp.clone().applyMatrix4(tf));
  } else if (activeTool === 'scale') {
    const scl = Math.max(0.1, Math.min(5, 1 + (mouse.x - transformStartMouse.x) * 2));
    transformStartPositions.forEach(sp => {
      const rel = new THREE.Vector3().subVectors(sp.pos, transformCentroid).multiplyScalar(scl);
      topo.moveV(sp.id, new THREE.Vector3().copy(transformCentroid).add(rel));
    });
    applyToRefCorners(sp => {
      const rel = new THREE.Vector3().subVectors(sp, transformCentroid).multiplyScalar(scl);
      return new THREE.Vector3().copy(transformCentroid).add(rel);
    });
  }
}

function confirmTransform() {
  activeTool = 'idle';
  axisLock = null;
  clearAxisLine();
  transformStartPositions = [];
  transformRefCorners = [];
  updateHUD();
}

function cancelTransform() {
  if (activeTool === 'box') { activeTool = 'idle'; updateHUD(); return; }
  if (activeTool !== 'idle') {
    // Restore positions
    transformStartPositions.forEach(sp => topo.moveV(sp.id, sp.pos));
    transformRefCorners.forEach(rc => {
      const r = referenceImages.find(ref => ref.imageId === rc.imageId);
      if (r) moveRefCorner(rc.imageId, rc.cornerIndex, rc.pos);
    });
    activeTool = 'idle';
    axisLock = null;
    clearAxisLine();
    transformStartPositions = [];
    transformRefCorners = [];
    updateHUD();
  }
}

function showAxisLine() {
  clearAxisLine();
  if (!axisLock) return;
  const len = 100;
  const pts = [transformCentroid.clone(), transformCentroid.clone()];
  if (axisLock === 'x') { pts[0].x -= len; pts[1].x += len; }
  if (axisLock === 'y') { pts[0].y -= len; pts[1].y += len; }
  if (axisLock === 'z') { pts[0].z -= len; pts[1].z += len; }
  const col = axisLock === 'x' ? C.axisX : axisLock === 'y' ? C.axisY : C.axisZ;
  axisLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
  scene.add(axisLine);
}

function clearAxisLine() {
  if (axisLine) { scene.remove(axisLine); if (axisLine.geometry) axisLine.geometry.dispose(); if (axisLine.material) axisLine.material.dispose(); axisLine = null; }
}

// ============================================================================
// MODELING TOOLS
// ============================================================================
function doExtrude() {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];

  // Determine extrusion direction
  let normal;
  const faces = topo.faces.filter(f => f.vIds.every(v => selectedIds.has(v)));
  const selectedEdges = topo.edges.filter(e => selectedIds.has(e.v1) && selectedIds.has(e.v2));

  if (faces.length > 0) {
    // Face extrusion: use face normal
    const f = faces[0];
    const fv = f.vIds.map(id => topo.getV(id).pos);
    normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(fv[1], fv[0]),
      new THREE.Vector3().subVectors(fv[2], fv[0])
    ).normalize();
  } else if (selectedEdges.length > 0) {
    // Edge extrusion: use edgeOutward (extends in the edge's outward direction)
    normal = topo.edgeOutward(selectedEdges[0].id);
  } else {
    // Vertex extrusion: extend flat along the ground plane (horizontal), away from
    // the camera, so it doesn't shoot straight up. Grab (also flat) follows.
    const camFwd = new THREE.Vector3();
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, 1);
    normal = camFwd.normalize();
  }

  // Create new vertices offset along the extrusion direction.
  // Small default offset (0.25) so the extrude pushes out only a little; the
  // auto-grab below lets the user drag it further as needed.
  const EXTRUDE_OFFSET = 0.25;
  const newVerts = {};
  ids.forEach(id => {
    newVerts[id] = topo.addV(topo.getV(id).pos.clone().addScaledVector(normal, EXTRUDE_OFFSET)).id;
  });


  // For edge extrusion: create a face connecting old edge to new edge
  if (selectedEdges.length > 0 && faces.length === 0) {
    selectedEdges.forEach(e => {
      topo.addF([e.v1, e.v2, newVerts[e.v2], newVerts[e.v1]]);
    });
  }

  // Also create faces for ALL internal edges (both endpoints selected) to ensure filled quads
  const internalEdges = topo.edges.filter(e => selectedIds.has(e.v1) && selectedIds.has(e.v2));
  internalEdges.forEach(e => {
    topo.addF([e.v1, e.v2, newVerts[e.v2], newVerts[e.v1]]);
  });

  // Create side faces connecting old boundary edges to new verts
  const boundaryEdges = topo.edges.filter(e =>
    (selectedIds.has(e.v1) && !selectedIds.has(e.v2)) ||
    (!selectedIds.has(e.v1) && selectedIds.has(e.v2))
  );
  boundaryEdges.forEach(e => {
    const v1Sel = selectedIds.has(e.v1) ? e.v1 : e.v2;
    const v2Sel = selectedIds.has(e.v2) ? e.v2 : e.v1;
    topo.addF([v1Sel, v2Sel, newVerts[v2Sel], newVerts[v1Sel]]);
  });

  // If a full face was selected, create the top face
  if (faces.length > 0) {
    const f = faces[0];
    const newTopIds = f.vIds.map(v => newVerts[v]);
    topo.addF(newTopIds);
  }

  // If no faces but we have a closed loop of vertices, create a top face
  if (faces.length === 0 && ids.length >= 3) {
    const selEdges = topo.edges.filter(e => selectedIds.has(e.v1) && selectedIds.has(e.v2));
    if (selEdges.length >= ids.length) {
      topo.addF(ids.map(id => newVerts[id]));
    }
  }

  // Select new vertices
  selectedIds.clear();
  Object.values(newVerts).forEach(id => selectedIds.add(id));
  updateAllColors();
  updateHUD();

  // Auto-start grab mode so user can immediately move the extruded geometry
  startTransform('grab');
}

function doFill() {
  if (selectedIds.size < 2) return;
  const ids = [...selectedIds];
  if (ids.length === 2) {
    topo.addE(ids[0], ids[1]);
  } else if (ids.length === 3) {
    topo.addF(ids);
  } else if (ids.length === 4) {
    // Try to order as a proper quad: find connected boundary
    topo.addF(ids);
  } else {
    // 5+ vertices: fan triangulation from first vertex
    for (let i = 1; i < ids.length - 1; i++) {
      topo.addF([ids[0], ids[i], ids[i + 1]]);
    }
  }
  updateAllColors();
}

function doMerge() {
  if (selectedIds.size < 2) return;
  const ids = [...selectedIds];
  const c = topo.centroid(ids);
  const keepId = ids[0];
  topo.moveV(keepId, c);
  ids.slice(1).forEach(id => {
    topo.edges.filter(e => e.v1 === id || e.v2 === id).forEach(e => {
      if (e.v1 === id) e.v1 = keepId;
      if (e.v2 === id) e.v2 = keepId;
      topo.updateVGeo(keepId);
    });
    topo.faces.filter(f => f.vIds.includes(id)).forEach(f => {
      f.vIds = f.vIds.map(v => v === id ? keepId : v);
    });
    topo.removeV(id);
  });
  selectedIds.clear();
  selectedIds.add(keepId);
  // Clean up duplicate edges
  topo.edges = topo.edges.filter((e, i, arr) => arr.findIndex(x => (x.v1 === e.v1 && x.v2 === e.v2) || (x.v1 === e.v2 && x.v2 === e.v1)) === i);
  updateAllColors();
  updateHUD();
}

function doDelete() {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  ids.forEach(id => topo.removeV(id));
  selectedIds.clear();
  updateAllColors();
  updateHUD();
}

// ============================================================================
// 3D CURSOR
// ============================================================================
function placeCursor3D() {
  raycaster.setFromCamera(mouse, camera);
  // Collect all snappable objects: topology face meshes + reference image planes
  const targets = [];
  topo.faces.forEach(f => targets.push(f.mesh));
  referenceImages.forEach(ref => targets.push(ref.plane));
  const hits = targets.length > 0 ? raycaster.intersectObjects(targets, false) : [];
  if (hits.length > 0) {
    setCursor3D(hits[0].point.clone());
    return;
  }
  // Fallback: drop the cursor onto the horizontal ground plane at the current
  // cursor height. This guarantees the cursor (and camera orbit pivot) can always
  // be moved — even into empty space when lots of geometry is on screen.
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cursor3DPos.y);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(ground, hit)) {
    setCursor3D(hit);
  }
}

function setCursor3D(pos) {
  if (cursor3D) { scene.remove(cursor3D); cursor3D.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }); }
  cursor3DPos.copy(pos);
  cursor3D = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16), new THREE.MeshBasicMaterial({ color: C.cursorRing }));
  cursor3D.add(ring);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  cursor3D.add(dot);
  cursor3D.position.copy(pos);
  scene.add(cursor3D);
  orbitTarget.copy(pos);
  updateCameraOrbit();
}

// ============================================================================
// DISTANCE MATH
// ============================================================================
function distPtSeg(pt, a, b) {
  const v = new THREE.Vector3().subVectors(b, a);
  const w = new THREE.Vector3().subVectors(pt, a);
  const c1 = w.dot(v); if (c1 <= 0) return pt.distanceTo(a);
  const c2 = v.dot(v); if (c2 <= c1) return pt.distanceTo(b);
  return pt.distanceTo(new THREE.Vector3().copy(a).addScaledVector(v, c1 / c2));
}
function distRayPt(ro, rd, pt) {
  const v = new THREE.Vector3().subVectors(pt, ro);
  const t = v.dot(rd);
  return t < 0 ? pt.distanceTo(ro) : pt.distanceTo(new THREE.Vector3().copy(ro).addScaledVector(rd, t));
}
function distRaySeg(ro, rd, a, b) {
  const s = new THREE.Vector3().subVectors(b, a);
  const rxs = new THREE.Vector3().crossVectors(rd, s);
  const m = rxs.length();
  if (m < 1e-8) return Math.min(distRayPt(ro, rd, a), distRayPt(ro, rd, b));
  const qp = new THREE.Vector3().subVectors(a, ro);
  const t = new THREE.Vector3().crossVectors(qp, s).dot(rxs) / (m * m);
  const u = Math.max(0, Math.min(1, new THREE.Vector3().crossVectors(qp, rd).dot(rxs) / (m * m)));
  return new THREE.Vector3().copy(ro).addScaledVector(rd, t).distanceTo(new THREE.Vector3().copy(a).addScaledVector(s, u));
}

// ============================================================================
// HUD
// ============================================================================
function updateHUD() {
  const m = document.getElementById('mode-indicator');
  const t = document.getElementById('tool-indicator');
  const a = document.getElementById('axis-indicator');
  const s = document.getElementById('selected-indicator');

  if (m) { m.textContent = selectMode.toUpperCase(); m.className = 'badge badge-' + selectMode; }
  if (t) { t.textContent = activeTool.toUpperCase(); t.className = 'badge badge-' + (activeTool === 'idle' ? 'idle' : activeTool === 'grab' ? 'grab' : activeTool); }
  if (a) { a.style.display = axisLock ? 'inline-block' : 'none'; if (axisLock) a.textContent = axisLock.toUpperCase(); }
  if (s) {
    const vCount = selectedIds.size;
    const rcCount = selectedRefCorners.size;
    const parts = [];
    if (vCount > 0) parts.push(vCount + ' vert' + (vCount > 1 ? 's' : ''));
    if (rcCount > 0) parts.push(rcCount + ' ref');
    s.textContent = parts.length > 0 ? parts.join(', ') : 'None';
  }
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================
function animate() {
  requestAnimationFrame(animate);
  // Fly navigation uses ARROW KEYS + PageUp/PageDown so it never conflicts with
  // tool shortcuts (G/R/S/E/W/A/etc). This keeps the camera still while modeling.
  const delta = clock.getDelta();
  const spd = 5 * delta;
  const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
  const rt = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
  if (keys['arrowup']) { camera.position.addScaledVector(fw, spd); orbitTarget.addScaledVector(fw, spd); updateCameraOrbit(); }
  if (keys['arrowdown']) { camera.position.addScaledVector(fw, -spd); orbitTarget.addScaledVector(fw, -spd); updateCameraOrbit(); }
  if (keys['arrowleft']) { camera.position.addScaledVector(rt, -spd); orbitTarget.addScaledVector(rt, -spd); updateCameraOrbit(); }
  if (keys['arrowright']) { camera.position.addScaledVector(rt, spd); orbitTarget.addScaledVector(rt, spd); updateCameraOrbit(); }
  if (keys['pageup']) { camera.position.y += spd; orbitTarget.y += spd; updateCameraOrbit(); }
  if (keys['pagedown']) { camera.position.y -= spd; orbitTarget.y -= spd; updateCameraOrbit(); }

  // Update the navigation gizmo orientation to match the camera.
  updateGizmo();

  renderer.render(scene, camera);

}

// ============================================================================
// GRID LABELS
// ============================================================================
function addGridLabels() {
  const ag = new THREE.Group();
  ag.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xff4444 })));
  ag.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 10)]), new THREE.LineBasicMaterial({ color: 0x4444ff })));
  const mk = (txt, pos, col) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = col; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 64, 32);
    const tx = new THREE.CanvasTexture(c); tx.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false, depthWrite: false }));
    sp.position.copy(pos); sp.scale.set(1.5, 0.75, 1); return sp;
  };
  const lg = new THREE.Group();
  lg.add(mk('+X', new THREE.Vector3(10.5, 0.3, 0), '#ff6666'));
  lg.add(mk('-X', new THREE.Vector3(-10.5, 0.3, 0), '#ff6666'));
  lg.add(mk('+Z', new THREE.Vector3(0, 0.3, 10.5), '#6666ff'));
  lg.add(mk('-Z', new THREE.Vector3(0, 0.3, -10.5), '#6666ff'));
  lg.add(mk('0', new THREE.Vector3(0, 0.2, 0), '#ffffff'));
  for (let i = -10; i <= 10; i += 5) { if (i === 0) continue; lg.add(mk(i.toString(), new THREE.Vector3(i, 0.2, 0), '#888888')); lg.add(mk(i.toString(), new THREE.Vector3(0, 0.2, i), '#888888')); }
  scene.add(ag, lg);
}

// ============================================================================
// GLB EXPORT
// ============================================================================
async function exportGLB() {
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const es = new THREE.Scene();

    // Merge ALL face geometry into a single BufferGeometry for valid glTF
    const allPositions = [];
    const allNormals = [];
    const allIndices = [];
    let vertexOffset = 0;

    topo.faces.forEach(f => {
      const geo = f.mesh.geometry;
      const posArr = geo.attributes.position.array;
      const normArr = geo.attributes.normal ? geo.attributes.normal.array : null;
      const idxArr = geo.index ? geo.index.array : null;

      // Add positions
      for (let i = 0; i < posArr.length; i += 3) {
        allPositions.push(posArr[i], posArr[i + 1], posArr[i + 2]);
      }
      // Add normals (or compute if missing)
      if (normArr) {
        for (let i = 0; i < normArr.length; i += 3) {
          allNormals.push(normArr[i], normArr[i + 1], normArr[i + 2]);
        }
      } else {
        const count = posArr.length / 3;
        for (let i = 0; i < count; i++) {
          allNormals.push(0, 1, 0);
        }
      }
      // Add indices with offset
      if (idxArr) {
        for (let i = 0; i < idxArr.length; i++) {
          allIndices.push(idxArr[i] + vertexOffset);
        }
      } else {
        const count = posArr.length / 3;
        for (let i = 0; i < count; i++) {
          allIndices.push(i + vertexOffset);
        }
      }
      vertexOffset += posArr.length / 3;
    });

    // Create merged geometry
    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
    mergedGeo.setIndex(allIndices);

    const mergedMesh = new THREE.Mesh(mergedGeo, new THREE.MeshStandardMaterial({ color: C.faceDefault, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 }));
    es.add(mergedMesh);

    new GLTFExporter().parse(es, (r) => {
      const b = new Blob([r], { type: 'application/octet-stream' });
      const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = 'model.glb';
      document.body.appendChild(l); l.click(); document.body.removeChild(l); URL.revokeObjectURL(u);
      console.log('Exported model.glb with', topo.faces.length, 'faces merged into 1 mesh');
    }, (e) => console.error(e), { binary: true });

    mergedGeo.dispose();
    mergedMesh.material.dispose();
  } catch (e) { console.error(e); alert('Export failed: ' + e.message); }
}

// ============================================================================
// WIREFRAME DISPLAY MODE
// ============================================================================
function toggleWireframe() {
  wireframeMode = !wireframeMode;
  if (wireframeMode) {
    // Hide solid faces; keep verts + edges visible; show an X marker per face so
    // you can clearly see points, lines and where each tri/quad is — while the
    // reference image shows through the transparent (hidden) faces.
    topo.faces.forEach(f => { f.mesh.visible = false; });
    buildWireframeMarkers();
  } else {
    topo.faces.forEach(f => { f.mesh.visible = true; });
    clearWireframeMarkers();
  }
  const btn = document.getElementById('wireframe-btn');
  if (btn) { btn.textContent = wireframeMode ? 'Wireframe: ON' : 'Wireframe: OFF'; btn.classList.toggle('active', wireframeMode); }
  updateHUD();
}

function clearWireframeMarkers() {
  if (xMarkerGroup) {
    scene.remove(xMarkerGroup);
    xMarkerGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    xMarkerGroup = null;
  }
}

function buildWireframeMarkers() {
  clearWireframeMarkers();
  xMarkerGroup = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xff66cc });
  const s = 0.08;
  topo.faces.forEach(f => {
    const c = topo.centroid(f.vIds);
    const pts = [
      new THREE.Vector3(c.x - s, c.y, c.z - s), new THREE.Vector3(c.x + s, c.y, c.z + s),
      new THREE.Vector3(c.x - s, c.y, c.z + s), new THREE.Vector3(c.x + s, c.y, c.z - s),
    ];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    xMarkerGroup.add(new THREE.LineSegments(g, mat));
  });
  scene.add(xMarkerGroup);
}

// Rebuild markers + keep faces hidden after topology edits while wireframe is on
function updateWireframeMarkers() {
  buildWireframeMarkers();
  topo.faces.forEach(f => { f.mesh.visible = false; });
}

// ============================================================================
// SUBDIVIDE (add more geometry)
// ============================================================================
function subdivideSelected() {
  // Prefer subdividing fully-selected faces into quads; otherwise split selected edges.
  const fullFaces = topo.faces.filter(f => f.vIds.length >= 3 && f.vIds.every(v => selectedIds.has(v)));
  if (fullFaces.length > 0) {
    const newSel = new Set();
    fullFaces.map(f => f.id).forEach(fid => {
      subdivideFace(fid).forEach(id => newSel.add(id));
    });
    selectedIds = newSel;
    updateAllColors();
    updateHUD();
    return;
  }
  // Edge subdivision: split each selected edge at its midpoint
  const selEdges = topo.edges.filter(e => selectedIds.has(e.v1) && selectedIds.has(e.v2)).map(e => e.id);
  if (selEdges.length === 0) return;
  const added = [];
  selEdges.forEach(eid => {
    const e = topo.getE(eid); if (!e) return;
    const a = topo.getV(e.v1), b = topo.getV(e.v2);
    const mid = new THREE.Vector3().addVectors(a.pos, b.pos).multiplyScalar(0.5);
    const nv = topo.splitEdgeAt(eid, mid);
    if (nv) added.push(nv.id);
  });
  added.forEach(id => selectedIds.add(id));
  updateAllColors();
  updateHUD();
}

// Subdivide one face into 4 by inserting edge midpoints + a center vertex.
function subdivideFace(fid) {
  const f = topo.getF(fid);
  if (!f) return [];
  const loop = [...f.vIds];
  const center = topo.centroid(loop);
  const mids = [];
  for (let i = 0; i < loop.length; i++) {
    const a = topo.getV(loop[i]).pos, b = topo.getV(loop[(i + 1) % loop.length]).pos;
    mids.push(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  }
  const cv = topo.addV(center).id;
  const midIds = mids.map(p => topo.addV(p).id);
  // Build the new sub-faces FIRST so corner verts never get orphaned/cleaned.
  for (let i = 0; i < loop.length; i++) {
    const corner = loop[i];
    const mPrev = midIds[(i - 1 + loop.length) % loop.length];
    const mNext = midIds[i];
    topo.addF([mPrev, corner, mNext, cv]);
  }
  topo.removeF(fid);
  return [cv, ...midIds];
}

// ============================================================================
// KNIFE TOOL (cut edges/faces, adding new geometry)
// ============================================================================
function startKnife() {
  pushUndo();
  activeTool = 'knife';
  knifeChain = [];
  clearKnifePreview();
  updateHUD();
}

function finishKnife() {
  activeTool = 'idle';
  knifeChain = [];
  clearKnifePreview();
  updateAllColors();
  updateHUD();
}

function clearKnifePreview() {
  if (knifePreview) {
    scene.remove(knifePreview);
    if (knifePreview.geometry) knifePreview.geometry.dispose();
    if (knifePreview.material) knifePreview.material.dispose();
    knifePreview = null;
  }
}

function knifeClick() {
  raycaster.setFromCamera(mouse, camera);
  // Find the edge closest to the cursor ray and the closest point on it.
  let bestEid = null, bestD = Infinity, bestPt = null;
  topo.edges.forEach(e => {
    const a = topo.getV(e.v1).pos, b = topo.getV(e.v2).pos;
    const d = distRaySeg(raycaster.ray.origin, raycaster.ray.direction, a, b);
    if (d < bestD) {
      bestD = d;
      bestEid = e.id;
      bestPt = closestPtOnSegToRay(raycaster.ray.origin, raycaster.ray.direction, a, b);
    }
  });
  if (bestEid === null || bestD > 0.4) return;

  const nv = topo.splitEdgeAt(bestEid, bestPt);
  if (!nv) return;

  // Connect to the previous cut point: split a shared face, or add a loose edge.
  if (knifeChain.length > 0) {
    const prev = knifeChain[knifeChain.length - 1];
    const face = topo.faceContaining(prev, nv.id);
    if (face) topo.splitFace(face.id, prev, nv.id);
    else topo.addE(prev, nv.id);
  }
  knifeChain.push(nv.id);
  drawKnifePreview();
  updateAllColors();
}

function drawKnifePreview() {
  clearKnifePreview();
  const pts = knifeChain.map(id => { const v = topo.getV(id); return v ? v.pos.clone() : null; }).filter(Boolean);
  if (pts.length < 2) return;
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  knifePreview = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x00ffaa }));
  scene.add(knifePreview);
}

// Closest point on segment AB to a ray (origin ro, dir rd), clamped to the segment.
function closestPtOnSegToRay(ro, rd, a, b) {
  const s = new THREE.Vector3().subVectors(b, a);
  const rxs = new THREE.Vector3().crossVectors(rd, s);
  const m = rxs.length();
  let u = 0;
  if (m >= 1e-8) {
    const qp = new THREE.Vector3().subVectors(a, ro);
    u = new THREE.Vector3().crossVectors(qp, rd).dot(rxs) / (m * m);
  }
  u = Math.max(0, Math.min(1, u));
  return new THREE.Vector3().copy(a).addScaledVector(s, u);
}

// ============================================================================
// CONTEXT MENU (right-click)
// ============================================================================
function setupContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.addEventListener('mousedown', (ev) => ev.stopPropagation());
  menu.querySelectorAll('[data-action]').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.getAttribute('data-action');
      hideContextMenu();
      runContextAction(action);
    });
  });
  // Any non-right-click anywhere closes the menu.
  window.addEventListener('mousedown', (ev) => { if (ev.button !== 2) hideContextMenu(); });
}

function showContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) menu.style.display = 'none';
}

function runContextAction(action) {
  switch (action) {
    case 'subdivide': pushUndo(); subdivideSelected(); break;
    case 'knife': startKnife(); break;
    case 'wireframe': toggleWireframe(); break;
    case 'extrude': pushUndo(); doExtrude(); break;
    case 'fill': pushUndo(); doFill(); break;
    case 'merge': pushUndo(); doMerge(); break;
    case 'delete': pushUndo(); doDelete(); break;
  }
}

// ============================================================================
// STARTUP
// ============================================================================
init();
animate();
window.topo = topo;