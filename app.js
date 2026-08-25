import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const viewport = $('viewport');
const status = $('status');
const hint = $('hint');
const emptyState = $('emptyState');
const imageInput = $('imageInput');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, .01, 100);
const desktopGroup = new THREE.Group(); scene.add(desktopGroup);
const desktopGrid = new THREE.GridHelper(10, 20, 0x35545a, 0x1b2e33); desktopGrid.position.y = -.7; desktopGroup.add(desktopGrid);
const desktopCamera = new THREE.PerspectiveCamera(45, 1, .1, 100); desktopCamera.position.set(0, 2.5, 4.2); desktopCamera.lookAt(0, 0, 0);
let texture = null, imageMesh = null, previewMesh = null, xrSession = null, hitSource = null, viewerSpace = null, referenceSpace = null, currentHit = null, xrAnchor = null;
let placed = false, sizeFactor = 1, angle = 0, opacity = 1, lastPointers = new Map(), lastPinch = 0, lastAngle = 0;

function setStatus(value, tone = '') { status.textContent = value; status.className = `status ${tone}`; }
function makeMesh(preview = false) {
  if (!texture) return null;
  const aspect = texture.image.width / texture.image.height;
  const width = .9 * sizeFactor, height = width / aspect;
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: !preview });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = angle;
  mesh.position.y = .006;
  if (preview) material.opacity = Math.min(opacity, .55);
  return mesh;
}
function rebuildMesh() {
  if (imageMesh) { scene.remove(imageMesh); imageMesh.geometry.dispose(); imageMesh.material.dispose(); }
  imageMesh = makeMesh(false); if (imageMesh) { imageMesh.visible = placed; scene.add(imageMesh); }
  if (previewMesh) { scene.remove(previewMesh); previewMesh.geometry.dispose(); previewMesh.material.dispose(); }
  previewMesh = makeMesh(true); if (previewMesh) { previewMesh.visible = !placed; scene.add(previewMesh); }
}
function applyTransform(mesh) { if (!mesh) return; mesh.scale.setScalar(1); mesh.rotation.y = angle; mesh.material.opacity = placed ? opacity : Math.min(opacity, .55); }
function setImage(file) {
  const url = URL.createObjectURL(file); const loader = new THREE.TextureLoader();
  loader.load(url, (loaded) => { if (texture) texture.dispose(); texture = loaded; texture.colorSpace = THREE.SRGBColorSpace; sizeFactor = 1; angle = 0; placed = false; rebuildMesh(); emptyState.classList.add('hidden'); $('place').classList.remove('hidden'); hint.textContent = 'Scan a table or floor, then tap Place.'; setStatus('Image ready'); URL.revokeObjectURL(url); });
}
function resize() { renderer.setSize(viewport.clientWidth, viewport.clientHeight, false); camera.aspect = viewport.clientWidth / viewport.clientHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

async function startAR() {
  if (!navigator.xr) { $('unsupported').classList.remove('hidden'); setStatus('AR unavailable'); return; }
  if (!texture) { hint.textContent = 'Choose an image first.'; return; }
  try {
    xrSession = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local', 'hit-test'], optionalFeatures: ['dom-overlay', 'anchors', 'plane-detection', 'light-estimation'], domOverlay: { root: document.body } });
    renderer.xr.setReferenceSpaceType('local'); await renderer.xr.setSession(xrSession);
    referenceSpace = await xrSession.requestReferenceSpace('local'); viewerSpace = await xrSession.requestReferenceSpace('viewer');
    hitSource = await xrSession.requestHitTestSource({ space: viewerSpace });
    xrSession.addEventListener('end', () => { xrSession = null; hitSource = null; setStatus('AR ended'); $('startAr').classList.remove('hidden'); $('exitAr').classList.add('hidden'); });
    $('startAr').classList.add('hidden'); $('exitAr').classList.remove('hidden'); setStatus('Scan a surface'); hint.textContent = 'Move slowly until a surface is detected.';
  } catch (error) { setStatus('AR could not start'); hint.textContent = error.message || 'Use Chrome on a supported Android phone over HTTPS.'; }
}
function applyWorldPose(mesh, matrix) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(matrix); mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, .006, 0)); mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(angle)); }
function placeImage() { if (!currentHit || !previewMesh || !referenceSpace) { hint.textContent = 'Aim at a detected horizontal surface first.'; return; } const pose = currentHit.getPose(referenceSpace); if (!pose) return; placed = true; if (xrAnchor) xrAnchor.delete?.(); xrAnchor = null; applyWorldPose(imageMesh, pose.transform.matrix); imageMesh.visible = true; previewMesh.visible = false; currentHit.createAnchor?.().then((anchor) => { xrAnchor = anchor; }).catch(() => { xrAnchor = null; }); setStatus('Placed'); hint.textContent = 'Pinch to resize. Use the rotate buttons to turn the guide.'; }
function deleteImage() { if (xrAnchor) xrAnchor.delete?.(); xrAnchor = null; placed = false; if (imageMesh) imageMesh.visible = false; if (previewMesh) previewMesh.visible = true; setStatus(texture ? 'Image ready' : 'Ready'); hint.textContent = texture ? 'Scan a surface, then tap Place.' : 'Choose an image to begin.'; }

renderer.setAnimationLoop((time, frame) => {
  if (frame && xrSession && hitSource && referenceSpace) {
    const hits = frame.getHitTestResults(hitSource); currentHit = hits[0] || null;
    if (!placed && currentHit && previewMesh) { const pose = currentHit.getPose(referenceSpace); if (pose) { previewMesh.matrixAutoUpdate = false; previewMesh.matrix.fromArray(pose.transform.matrix); previewMesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, .006, 0)); } setStatus('Surface detected', 'ready'); }
    if (placed && imageMesh && xrAnchor) { const pose = frame.getPose(xrAnchor.anchorSpace, referenceSpace); if (pose) { imageMesh.matrixAutoUpdate = false; imageMesh.matrix.fromArray(pose.transform.matrix); imageMesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, .006, 0)); imageMesh.matrix.multiply(new THREE.Matrix4().makeRotationY(angle)); } }
  }
  renderer.render(scene, frame && xrSession ? renderer.xr.getCamera(camera) : desktopCamera);
});

imageInput.addEventListener('change', () => imageInput.files[0] && setImage(imageInput.files[0])); $('choose').addEventListener('click', () => imageInput.click()); $('startAr').addEventListener('click', startAR); $('exitAr').addEventListener('click', () => xrSession?.end()); $('place').addEventListener('click', placeImage); $('delete').addEventListener('click', deleteImage);
$('opacity').addEventListener('input', (e) => { opacity = Number(e.target.value) / 100; $('opacityValue').value = `${e.target.value}%`; if (imageMesh) imageMesh.material.opacity = opacity; if (previewMesh) previewMesh.material.opacity = Math.min(opacity, .55); });
$('size').addEventListener('input', (e) => { sizeFactor = Number(e.target.value) / 100; $('sizeValue').value = `${sizeFactor.toFixed(1)}x`; rebuildMesh(); });
$('rotateLeft').addEventListener('click', () => { angle -= Math.PI / 12; rebuildMesh(); }); $('rotateRight').addEventListener('click', () => { angle += Math.PI / 12; rebuildMesh(); });
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); lastPointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (lastPointers.size === 2) { const p = [...lastPointers.values()]; lastPinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); lastAngle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); } });
canvas.addEventListener('pointermove', (e) => { if (!lastPointers.has(e.pointerId)) return; lastPointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (lastPointers.size === 2 && placed) { const p = [...lastPointers.values()]; const pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); sizeFactor = Math.max(.25, Math.min(3, sizeFactor * pinch / lastPinch)); $('size').value = sizeFactor * 100; $('sizeValue').value = `${sizeFactor.toFixed(1)}x`; angle += Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) - lastAngle; rebuildMesh(); lastPinch = pinch; lastAngle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); } });
['pointerup', 'pointercancel'].forEach((event) => canvas.addEventListener(event, (e) => lastPointers.delete(e.pointerId)));
