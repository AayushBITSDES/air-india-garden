/* Textured Earth for the garden panel and the "booking still open" intro.
   Day texture + cloud layer + atmosphere rim. India (78E, 22N) faces the camera at rest. */
import * as THREE from './three.module.js';
import { EARTH, CLOUDS } from './earth-data.js';

const INDIA_Y = -(78 + 90) * Math.PI / 180; // rotation.y that brings 78E to the front
let textures = null;

function loadTextures() {
  if (textures) return textures;
  const loader = new THREE.TextureLoader();
  const map = loader.load(EARTH);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const clouds = loader.load(CLOUDS);
  textures = { map, clouds };
  return textures;
}

const glowVert = `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const rimFrag = `
  uniform vec3 uColor;
  uniform float uPow;
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - max(dot(vN, vV), 0.0), uPow) * uStrength;
    gl_FragColor = vec4(uColor * f, f);
  }`;
const haloFrag = `
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(clamp(-dot(vN, vV) * 2.1, 0.0, 1.0), 3.0) * 0.9;
    gl_FragColor = vec4(uColor * f, f);
  }`;

function rim(radius, side, frag, extra) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: frag,
      uniforms: { uColor: { value: new THREE.Color(0x7cc4ff) }, ...extra },
      side,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })
  );
}

function stars(n) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60);
    if (v.z > 0) v.z *= -1;
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.35 + Math.random() * 0.65;
    col.set([b, b * (0.92 + Math.random() * 0.08), b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
}

/* opts.mode: 'badge' (small, slow spin) or 'intro' (full screen, spins in and settles on India). */
function mount(el, opts = {}) {
  const mode = opts.mode || 'badge';
  const { map, clouds } = loadTextures();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mode === 'intro' ? 22 : 26, 1, 0.1, 200);

  const tilt = new THREE.Group();
  tilt.rotation.x = 0.36; // lean the north toward us so India sits near the middle
  tilt.rotation.z = -0.16;
  scene.add(tilt);

  const spin = new THREE.Group();
  tilt.add(spin);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 })
  );
  spin.add(earth);
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 96, 64),
    new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: clouds, transparent: true, opacity: 0.8, depthWrite: false, roughness: 1 })
  );
  spin.add(cloudMesh);

  scene.add(rim(1.016, THREE.FrontSide, rimFrag, { uPow: { value: 3.2 }, uStrength: { value: mode === 'intro' ? 1.1 : 0.6 } }));
  scene.add(rim(1.14, THREE.BackSide, haloFrag, {}));

  scene.add(new THREE.AmbientLight(0xb8c8e8, 0.7));
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.4);
  sun.position.set(-2, 1.5, 4);
  scene.add(sun);
  if (mode === 'intro') scene.add(stars(900));

  let lastW = 0, lastH = 0;
  function resize() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    lastW = el.clientWidth;
    lastH = el.clientHeight;
    camera.aspect = w / h;
    // badge: globe fills the box. intro: globe is ~min(320px, 38% of height) tall.
    const px = mode === 'intro' ? Math.min(320, h * 0.38) : Math.min(w, h) * 0.8;
    const visible = 2.3 * h / px;
    const lift = mode === 'intro' ? -0.08 * visible : 0; // intro: globe sits at 42% height
    camera.position.set(0, lift, visible / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    camera.lookAt(0, lift, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  window.addEventListener('resize', resize);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const dur = opts.duration || 2400;
  let raf = 0;
  let alive = true;

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!el.offsetParent && mode === 'badge') return; // hidden page: skip work
    if (el.clientWidth !== lastW || el.clientHeight !== lastH) resize(); // mounted while hidden
    const t = (now - t0) / 1000;
    if (mode === 'intro') {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      spin.rotation.y = INDIA_Y - (1 - e) * 2.6;
      const s = 0.82 + 0.18 * e;
      tilt.scale.setScalar(s);
      cloudMesh.rotation.y = t * 0.05;
    } else {
      spin.rotation.y = reduce ? INDIA_Y : INDIA_Y + Math.sin(t * 0.2) * 0.45;
      cloudMesh.rotation.y = reduce ? 0 : t * 0.025;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}

window.Earth3D = { mount };
