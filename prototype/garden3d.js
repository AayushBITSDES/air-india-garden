/* Garden island, Three.js.
   Look: soft daylight, image-based light from a generated sky, filmic tone mapping.
   Trees are built from thousands of instanced leaves / blossoms around lobed canopies,
   using the same palettes as the collection drawings (treeSVG / PAL in index.html):
   banyan in the middle, two cherry blossoms. */
import * as THREE from './three.module.js';
import { mergeGeometries, mergeVertices } from './jsm/utils/BufferGeometryUtils.js';
import './earth3d.js';

(function () {
  const R = 1.12;
  const WATER = 0.18;
  const PAL = {
    banyan: { leaf: [0x2C5A36, 0x3E7A48, 0x6FA266, 0xB5D392], trunk: 0x6B4A33, root: 0x87654A },
    cherry: { leaf: [0xD97C90, 0xF2A9B9, 0xFAD3DC, 0xFFF4F6], trunk: 0x5A2E3A }
  };
  const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

  let renderer, camera, scene, island, tree, stake, halo, glow, motes, raycaster, pointer;
  let water, grassMat, petals, burst;
  const timeU = { value: 0 };
  let apples = [];
  const pivots = [];
  let planted = false;
  let ripe = false;
  let mode = 'idle';
  let shake = null;
  let growFrom = 0;
  let drag = null;
  let spinVel = 0;
  let hoverPivot = null;
  let last = 0;
  let appleCb = null;
  const treeHits = [];
  const camBase = new THREE.Vector3(8.6, 6.6, 9.4);
  const lookAt = new THREE.Vector3(0.05, 0.85, 0);

  /* ---------- small utils ---------- */
  function rand(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = s * 16807 % 2147483647) / 2147483647;
  }
  function axial(q, r) {
    return [R * 1.5 * q, R * Math.sqrt(3) * (r + q / 2)];
  }
  function canvasTex(size, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function radialTex(stops) {
    return canvasTex(256, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      stops.forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }
  function decal(radius, tex, opacity, y, blending = THREE.NormalBlending) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending, toneMapped: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 2;
    return m;
  }
  function shadowed(mesh, cast = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    return mesh;
  }
  // Deterministic lumpy sphere: displacement depends only on position, so seams stay closed.
  function lumpy(detail, amt, seed) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 4.1 + seed) * Math.cos(v.y * 3.3 - seed * 0.7) + Math.sin(v.z * 5.3 + v.x * 2.1 + seed * 1.3) * 0.6;
      v.multiplyScalar(1 + n * amt);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  // Tube whose radius tapers from r0 to r1 along its length.
  function taperTube(points, r0, r1, radial = 7, segs = 14) {
    const curve = new THREE.CatmullRomCurve3(points);
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = g.attributes.position;
    const c = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, c);
      const r = r0 + (r1 - r0) * Math.pow(i / segs, 0.8);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return g;
  }

  /* ---------- textures ---------- */
  function barkTexture() {
    const t = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#d8d2cc';
      ctx.fillRect(0, 0, s, s);
      const rnd = rand(5);
      for (let i = 0; i < 260; i++) {
        const x = rnd() * s, y = rnd() * s, w = 1 + rnd() * 3, h = 6 + rnd() * 26;
        ctx.fillStyle = rnd() > 0.55 ? `rgba(60,40,30,${0.15 + rnd() * 0.3})` : `rgba(255,250,240,${0.1 + rnd() * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }
  // Tileable ripple normal map from integer-frequency sines.
  function waterNormals() {
    const N = 256;
    const h = new Float32Array(N * N);
    const waves = [[4, 1, 0.22, 0.2], [-2, 5, 0.22, 1.3], [6, -5, 0.16, 2.1], [-7, -6, 0.14, 0.7], [11, 3, 0.09, 3.3], [-4, 12, 0.09, 1.9], [15, -11, 0.05, 2.6], [-17, -9, 0.05, 0.4], [9, 19, 0.04, 1.1]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      waves.forEach(([fx, fy, a, ph]) => { v += a * Math.sin(2 * Math.PI * (fx * x + fy * y) / N + ph); });
      h[y * N + x] = v;
    }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /* ---------- sky light ---------- */
  function skyEnvironment() {
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {},
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 top = vec3(0.36, 0.58, 0.86);
            vec3 hor = vec3(1.0, 0.96, 0.9);
            vec3 gnd = vec3(0.28, 0.36, 0.3);
            vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.4));
            gl_FragColor = vec4(c * 1.1, 1.0);
          }`
      })
    );
    env.add(sky);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9) }));
    sunDisc.position.copy(SUN_DIR).multiplyScalar(40);
    env.add(sunDisc);
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(env, 0.035).texture;
    pm.dispose();
    return tex;
  }

  /* ---------- foliage ---------- */
  function leafGeometry() {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.52, 0.38, 0, 1);
    s.quadraticCurveTo(-0.52, 0.38, 0, 0);
    const g = new THREE.ShapeGeometry(s, 4);
    g.translate(0, -0.15, 0);
    g.rotateX(-0.25); // slight cup
    return g;
  }
  function petalShape() {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.42, 0.18, 0.42, 0.82, 0.13, 1);
    s.lineTo(0, 0.9);
    s.lineTo(-0.13, 1);
    s.bezierCurveTo(-0.42, 0.82, -0.42, 0.18, 0, 0);
    return s;
  }
  function blossomGeometry() {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const g = new THREE.ShapeGeometry(petalShape(), 3);
      g.scale(0.5, 0.5, 0.5);
      g.rotateX(-0.45);
      g.rotateZ(k * Math.PI * 2 / 5);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }

  // Fill lobes with instanced leaves. Colour follows the drawings: dark underneath,
  // mid in the body, light on the sun side, a few pale highlights on top.
  function canopy(group, lobes, opts) {
    const rnd = rand(opts.seed);
    const area = lobes.map(l => l[3] * l[4] + l[4] * l[5] + l[3] * l[5]);
    const total = area.reduce((a, b) => a + b, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: opts.rough ?? 0.85, metalness: 0, envMapIntensity: 0.45 });
    const mesh = shadowed(new THREE.InstancedMesh(opts.geo, mat, opts.count));
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const pal = opts.pal.map(h => new THREE.Color(h));
    let i = 0;
    lobes.forEach(([x, y, z, rx, ry, rz], li) => {
      const n = li === lobes.length - 1 ? opts.count - i : Math.round(opts.count * area[li] / total);
      for (let k = 0; k < n && i < opts.count; k++, i++) {
        const d = new THREE.Vector3().randomDirection();
        const r = 1 - Math.pow(rnd(), 2.2) * 0.4;
        const p = new THREE.Vector3(x + d.x * rx * r, y + d.y * ry * r, z + d.z * rz * r);
        dummy.position.copy(p);
        dummy.lookAt(p.clone().add(d));
        dummy.rotateZ(rnd() * Math.PI * 2);
        dummy.rotateX((rnd() - 0.5) * 1.2);
        dummy.scale.setScalar(opts.size * (0.7 + rnd() * 0.6));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const lit = d.dot(SUN_DIR) * 0.6 + d.y * 0.5 + (r - 0.8) + (rnd() - 0.5) * 0.5;
        const idx = lit < -0.15 ? 0 : lit < 0.5 ? 1 : lit < 1.15 ? 2 : 3;
        col.copy(pal[idx]);
        col.offsetHSL((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.06);
        mesh.setColorAt(i, col);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    // Dark core so you never see through the canopy.
    const core = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.pal[0]).multiplyScalar(0.7), roughness: 0.9 });
    lobes.forEach(([x, y, z, rx, ry, rz], li) => {
      const m = shadowed(new THREE.Mesh(lumpy(2, 0.12, opts.seed + li), core));
      m.position.set(x, y, z);
      m.scale.set(rx * 0.78, ry * 0.74, rz * 0.78);
      group.add(m);
    });
    return mesh;
  }

  function canopyProxy(group, lobes) {
    const geo = new THREE.SphereGeometry(1, 12, 8);
    lobes.forEach(([x, y, z, rx, ry, rz]) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      m.visible = false;
      m.position.set(x, y, z);
      m.scale.set(rx * 1.05, ry * 1.1, rz * 1.05);
      group.add(m);
    });
  }

  function trunkGeometry(profile, flute, seed) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 28);
    const p = g.attributes.position;
    const top = profile[profile.length - 1][1];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + flute * Math.sin(a * 7 + seed + y * 3) * (1 - y / top) + 0.03 * Math.sin(a * 13 + y * 9);
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  }

  function makeBanyan() {
    const g = new THREE.Group();
    const rnd = rand(11);
    const bark = new THREE.MeshStandardMaterial({ color: PAL.banyan.trunk, map: barkTexture(), roughness: 0.95 });
    const wood = [trunkGeometry([[0, 0], [0.2, 0], [0.15, 0.04], [0.11, 0.13], [0.09, 0.32], [0.08, 0.5], [0.075, 0.66], [0, 0.68]], 0.22, 1)];
    const lobes = [
      [0, 1.02, 0, 0.56, 0.24, 0.48], [-0.52, 0.92, 0.06, 0.36, 0.18, 0.32], [0.54, 0.9, -0.04, 0.36, 0.18, 0.32],
      [0.06, 1.17, -0.04, 0.36, 0.16, 0.3], [-0.16, 0.9, -0.4, 0.34, 0.16, 0.26], [0.2, 0.9, 0.4, 0.32, 0.16, 0.26],
      [-0.3, 1.06, 0.3, 0.26, 0.14, 0.22], [0.34, 1.05, -0.3, 0.26, 0.14, 0.22]
    ];
    lobes.slice(1).concat([[0.1, 1.0, 0.05]]).forEach(([x, y, z]) => {
      const end = new THREE.Vector3(x * 0.9, y - 0.08, z * 0.9);
      const mid = new THREE.Vector3(x * 0.45, 0.66 + (y - 0.66) * 0.35, z * 0.45);
      wood.push(taperTube([new THREE.Vector3(x * 0.05, 0.56, z * 0.05), mid, end], 0.05, 0.012, 7, 12));
    });
    // Aerial roots: the banyan's signature. Some reach the ground, some still hanging.
    const root = new THREE.MeshStandardMaterial({ color: PAL.banyan.root, map: barkTexture(), roughness: 0.95 });
    const roots = [];
    for (let i = 0; i < 44; i++) {
      // Drop from the underside of the canopy, spread across its full width like the drawing.
      const a = rnd() * Math.PI * 2;
      const rr = 0.16 + Math.sqrt(rnd()) * 0.5;
      const top = new THREE.Vector3(Math.cos(a) * rr * 1.1, 0.86 + rnd() * 0.06, Math.sin(a) * rr * 0.9);
      const full = i % 3 !== 2;
      const endY = full ? -0.02 : 0.3 + rnd() * 0.35;
      const wob = () => (rnd() - 0.5) * 0.04;
      const pts = [top, new THREE.Vector3(top.x + wob(), top.y * 0.66 + endY * 0.34, top.z + wob()),
        new THREE.Vector3(top.x + wob(), top.y * 0.33 + endY * 0.67, top.z + wob()), new THREE.Vector3(top.x + wob(), endY, top.z + wob())];
      roots.push(taperTube(pts, 0.005, full ? (i % 5 === 0 ? 0.026 : 0.014) : 0.003, 5, 8));
    }
    g.add(shadowed(new THREE.Mesh(mergeGeometries(wood), bark)));
    g.add(shadowed(new THREE.Mesh(mergeGeometries(roots), root)));
    canopy(g, lobes, { seed: 7, count: 4200, geo: leafGeometry(), size: 0.085, pal: PAL.banyan.leaf });
    canopyProxy(g, lobes);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 8), new THREE.MeshBasicMaterial({ visible: false })));
    g.userData.lobes = lobes;
    return g;
  }

  function makeCherry(seed) {
    const g = new THREE.Group();
    const rnd = rand(seed);
    const bark = new THREE.MeshStandardMaterial({ color: PAL.cherry.trunk, map: barkTexture(), roughness: 0.9 });
    const wood = [trunkGeometry([[0, 0], [0.085, 0], [0.065, 0.05], [0.05, 0.25], [0.045, 0.42], [0, 0.44]], 0.12, seed)];
    const lobes = [];
    const tips = [[-0.36, 0.78, 0.08], [0.34, 0.8, -0.06], [-0.06, 0.98, -0.16], [0.1, 0.94, 0.2], [0.02, 1.08, 0.02]];
    tips.forEach(([x, y, z], i) => {
      const end = new THREE.Vector3(x, y - 0.06, z);
      const mid = new THREE.Vector3(x * 0.45 + (rnd() - 0.5) * 0.06, 0.52 + (y - 0.52) * 0.3, z * 0.45);
      wood.push(taperTube([new THREE.Vector3(0, 0.38, 0), mid, end], 0.032, 0.008, 6, 12));
      // twigs
      for (let k = 0; k < 2; k++) {
        const tw = new THREE.Vector3(x + (rnd() - 0.5) * 0.3, y + rnd() * 0.12, z + (rnd() - 0.5) * 0.3);
        wood.push(taperTube([end, end.clone().lerp(tw, 0.5).add(new THREE.Vector3(0, 0.03, 0)), tw], 0.008, 0.003, 4, 6));
      }
      lobes.push([x, y, z, 0.24 + rnd() * 0.06, 0.15 + rnd() * 0.04, 0.22 + rnd() * 0.05]);
      if (i === 4) lobes[i][3] = lobes[i][5] = 0.2;
    });
    g.add(shadowed(new THREE.Mesh(mergeGeometries(wood), bark)));
    canopy(g, lobes, { seed, count: 1500, geo: blossomGeometry(), size: 0.075, pal: PAL.cherry.leaf, rough: 0.7 });
    canopyProxy(g, lobes);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8), new THREE.MeshBasicMaterial({ visible: false })));
    g.userData.lobes = lobes;
    return g;
  }

  function tagHits(root, kind, pivot) {
    root.traverse(obj => {
      if (!obj.isMesh || obj.isInstancedMesh) return;
      obj.userData.kind = kind;
      obj.userData.pivot = pivot;
      treeHits.push(obj);
    });
  }

  function sitTree(group, q, r, surfaceY, scale, rot, kind) {
    const [x, z] = axial(q, r);
    const pivot = new THREE.Group();
    pivot.position.set(x, surfaceY, z);
    pivot.rotation.y = rot;
    group.scale.setScalar(scale);
    pivot.add(group);
    island.add(pivot);
    tagHits(pivot, kind, pivot);
    pivot.userData.base = 1;
    pivots.push(pivot);
    island.add(decalAO(x, z, surfaceY, 0.62 * scale));
    return pivot;
  }

  let aoTex;
  function decalAO(x, z, y, r) {
    aoTex = aoTex || radialTex([[0, 'rgba(20,30,10,.55)'], [0.5, 'rgba(20,30,10,.25)'], [1, 'rgba(20,30,10,0)']]);
    const m = decal(r, aoTex, 1, y + 0.004);
    m.position.x = x;
    m.position.z = z;
    return m;
  }

  /* ---------- apples ---------- */
  let appleGeo, appleMats;
  function appleParts() {
    if (appleGeo) return;
    const prof = [[0, -0.8], [0.32, -0.92], [0.66, -0.74], [0.9, -0.34], [0.97, 0.06], [0.88, 0.5], [0.62, 0.82], [0.3, 0.9], [0.1, 0.74], [0, 0.68]];
    appleGeo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24);
    appleGeo.scale(0.058, 0.058, 0.058);
    const leaf = leafGeometry();
    leaf.scale(0.05, 0.05, 0.05);
    leaf.rotateZ(-1.1);
    leaf.translate(0.012, 0.062, 0);
    appleMats = {
      skin: new THREE.MeshPhysicalMaterial({ color: 0xC4102C, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: new THREE.Color(0xff6a6a) }),
      stem: new THREE.MeshStandardMaterial({ color: 0x5E4630, roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x4E8A3E, roughness: 0.6, side: THREE.DoubleSide }),
      leafGeo: leaf
    };
  }
  function makeApple() {
    appleParts();
    const a = new THREE.Group();
    a.add(shadowed(new THREE.Mesh(appleGeo, appleMats.skin)));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.04, 5), appleMats.stem);
    stem.position.y = 0.055;
    stem.rotation.z = 0.25;
    a.add(stem);
    a.add(new THREE.Mesh(appleMats.leafGeo, appleMats.leaf));
    return a;
  }
  // Distance from the trunk axis to the canopy's outer skin, along angle a at height y.
  function hull(lobes, a, y) {
    let best = 0;
    lobes.forEach(([cx, cy, cz, rx, ry, rz]) => {
      for (let s = 1.4; s > 0; s -= 0.01) {
        const dx = (Math.cos(a) * s - cx) / rx, dy = (y - cy) / ry, dz = (Math.sin(a) * s - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1) { best = Math.max(best, s); break; }
      }
    });
    return best;
  }
  function makeApples(n, parent, lobes) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const mesh = makeApple();
      const ang = (i / n) * Math.PI * 2 + 0.35;
      const y = 0.8 + (i % 3) * 0.07;
      const s = hull(lobes, ang, y) + 0.015;
      mesh.position.set(Math.cos(ang) * s, y, Math.sin(ang) * s);
      mesh.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 6, (Math.random() - 0.5) * 0.3);
      parent.add(mesh);
      list.push({ mesh, phase: 'hang', home: mesh.position.clone() });
    }
    return list;
  }

  /* ---------- island ---------- */
  function hexShape(radius) {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }
  let sandTex;
  function tile(top, depth, topColor, sideTop, sideBottom, sandy) {
    const bevel = 0.05;
    const g = new THREE.ExtrudeGeometry(hexShape(R * 0.95), {
      depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 1
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, top - depth + bevel, 0);
    // Gradient down the sides: lighter under the lip, darker and wetter at the waterline.
    const p = g.attributes.position;
    const c = new Float32Array(p.count * 3);
    const a = new THREE.Color(sideTop), b = new THREE.Color(sideBottom), t = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = THREE.MathUtils.clamp((top - y) / (top - WATER + 0.05), 0, 1);
      t.copy(a).lerp(b, Math.pow(k, 0.8));
      const n = (Math.sin(p.getX(i) * 13 + y * 31) * 0.5 + 0.5) * 0.06;
      c.set([t.r - n, t.g - n, t.b - n], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return shadowed(new THREE.Mesh(g, [
      new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.95, map: sandy ? (sandTex = sandTex || speckle()) : null }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
    ]));
  }

  function speckle() {
    const t = canvasTex(256, (ctx, s) => {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, s, s);
      const rnd = rand(17);
      for (let i = 0; i < 2600; i++) {
        const v = 170 + rnd() * 85 | 0;
        ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.25 + rnd() * 0.5})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.5, 1.5);
    return t;
  }

  function grass(spots) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.3, 0.5, 0.04, 0.3, 0.5, 0.04, 0, 1, 0.1], 3));
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    geo.computeVertexNormals();
    grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 });
    grassMat.onBeforeCompile = s => {
      s.uniforms.uTime = timeU;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float sway = sin(uTime * 1.4 + ip.x * 2.3 + ip.z * 1.7) * 0.22 + sin(uTime * 2.7 + ip.x * 6.0) * 0.07;
          transformed.x += sway * position.y * position.y;
        #endif`);
    };
    const count = 4200;
    const mesh = new THREE.InstancedMesh(geo, grassMat, count);
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const greens = [0x4F7F38, 0x5E8F41, 0x6FA24C, 0x87B35A, 0x3F6B2E].map(h => new THREE.Color(h));
    const rnd = rand(3);
    const flowers = [];
    for (let i = 0; i < count; i++) {
      const s = spots[i % spots.length];
      let x, z;
      do { x = (rnd() * 2 - 1); z = (rnd() * 2 - 1); } while (x * x + z * z > 1);
      const rr = R * 0.86;
      dummy.position.set(s.x + x * rr, s.top - 0.005, s.z + z * rr);
      dummy.rotation.set((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
      const h = 0.045 + rnd() * 0.07;
      dummy.scale.set(0.022 + rnd() * 0.012, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.copy(greens[Math.floor(rnd() * greens.length)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
      mesh.setColorAt(i, col);
      if (i % 70 === 0) flowers.push(dummy.position.clone().setY(s.top + h * 0.7));
    }
    island.add(mesh);
    // A few marigold and white flowers in the grass.
    const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.014, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), flowers.length);
    flowers.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 0.6, 1);
      dummy.updateMatrix();
      fl.setMatrixAt(i, dummy.matrix);
      fl.setColorAt(i, new THREE.Color([0xF2A33A, 0xFFF6E8, 0xF7C948][i % 3]));
    });
    island.add(fl);
  }

  function pebbles(sandTiles) {
    const rnd = rand(29);
    const n = 160;
    const m = new THREE.InstancedMesh(lumpy(1, 0.2, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), n);
    m.castShadow = m.receiveShadow = true;
    const d = new THREE.Object3D();
    const tones = [0x9A938A, 0xB5AC9C, 0x7E786F, 0xC9BFAE].map(h => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      const t = sandTiles[i % sandTiles.length];
      const [x, z] = axial(t.q, t.r);
      let u, v;
      do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; } while (u * u + v * v > 1);
      const sc = 0.012 + Math.pow(rnd(), 3) * 0.04;
      d.position.set(x + u * R * 0.8, t.top + sc * 0.3, z + v * R * 0.8);
      d.rotation.set(0, rnd() * 6, 0);
      d.scale.set(sc * (1 + rnd() * 0.6), sc * 0.55, sc);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, tones[i % 4]);
    }
    island.add(m);
  }

  function rock(s, seed) {
    const g = lumpy(1, 0.25, seed);
    const m = shadowed(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8E9692, roughness: 0.9, flatShading: true })));
    m.scale.set(s, s * 0.65, s * 0.9);
    m.rotation.y = seed;
    return m;
  }

  function makeDock() {
    const g = new THREE.Group();
    const rnd = rand(9);
    const tones = [0xA8784A, 0x96693F, 0xB38350].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, map: barkTexture() }));
    for (let i = 0; i < 7; i++) {
      const plank = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.13), tones[i % 3]));
      plank.position.set((rnd() - 0.5) * 0.04, 0.05, i * 0.155);
      plank.rotation.y = (rnd() - 0.5) * 0.04;
      g.add(plank);
    }
    const post = new THREE.MeshStandardMaterial({ color: 0x6E4B2C, roughness: 0.95 });
    [[-0.4, 0.05], [0.4, 0.05], [-0.4, 0.95], [0.4, 0.95]].forEach(([x, z]) => {
      const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 8), post));
      p.position.set(x, -0.12, z);
      g.add(p);
    });
    return g;
  }

  /* ---------- particles: petals drifting from the cherries, leaves when shaken ---------- */
  function flutter(geo, color, count, emissive = 0) {
    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6, emissive: color, emissiveIntensity: emissive });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const parts = Array.from({ length: count }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0, ground: 0, t: 0 }));
    const dummy = new THREE.Object3D();
    function step(dt, now) {
      parts.forEach((q, i) => {
        if (q.alive) {
          q.t += dt;
          q.v.y = Math.max(q.v.y - 1.2 * dt, -0.32);
          q.p.addScaledVector(q.v, dt);
          q.p.x += Math.sin(now * 0.002 + i) * 0.12 * dt;
          q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
          if (q.p.y <= q.ground) { q.p.y = q.ground; q.v.set(0, 0, 0); q.w.set(0, 0, 0); q.rest = (q.rest || 0) + dt; }
          if ((q.rest || 0) > 2.5) q.alive = false;
        }
        dummy.position.copy(q.p);
        dummy.rotation.copy(q.r);
        dummy.scale.setScalar(q.alive ? q.s : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    function emit(pos, ground, size, spread = 0.3, up = 0) {
      const q = parts.find(x => !x.alive);
      if (!q) return;
      q.alive = true;
      q.rest = 0;
      q.t = 0;
      q.p.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread));
      q.v.set((Math.random() - 0.5) * 0.3, up, (Math.random() - 0.5) * 0.3);
      q.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      q.w.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      q.s = size * (0.7 + Math.random() * 0.6);
      q.ground = ground;
    }
    return { mesh, step, emit };
  }

  function makeMotes() {
    const n = 26;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const tex = radialTex([[0, 'rgba(255,240,200,1)'], [0.25, 'rgba(255,214,140,.8)'], [1, 'rgba(235,190,105,0)']]);
    const m = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: 0.09, color: 0xFFE2A6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.userData.seeds = Array.from({ length: n }, () => [Math.random() * 6.28, 0.25 + Math.random() * 0.45, Math.random(), 0.25 + Math.random() * 0.4]);
    m.frustumCulled = false;
    return m;
  }

  /* ---------- screen helpers ---------- */
  function screenOf(obj) {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    v.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
  }

  function resize() {
    const el = renderer.domElement.parentElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    // Keep the island the same size on narrow screens.
    camera.fov = w / h < 1.4 ? 38 : 32;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  /* ---------- mount ---------- */
  function mount(el, appleCount) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const haze = new THREE.Color(0xBFE0E4);
    scene.background = haze;
    scene.fog = new THREE.Fog(haze, 15, 32);
    scene.environment = skyEnvironment();

    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    camera.position.copy(camBase);
    camera.lookAt(lookAt);

    scene.add(new THREE.HemisphereLight(0xEAF4FF, 0x5D6B4A, 0.35));
    const sun = new THREE.DirectionalLight(0xFFF0D8, 2.3);
    sun.position.copy(SUN_DIR).multiplyScalar(14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 4, far: 30, left: -5, right: 5, top: 5, bottom: -5 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // Water: glossy, rippled, deeper colour away from the island.
    const wn = waterNormals();
    wn.repeat.set(26, 26);
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshPhysicalMaterial({ color: 0x1F7F98, roughness: 0.14, metalness: 0, normalMap: wn, normalScale: new THREE.Vector2(0.18, 0.18), clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 0.8 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER;
    water.receiveShadow = true;
    scene.add(water);

    island = new THREE.Group();
    island.rotation.y = -0.45;
    scene.add(island);

    island.add(decal(5.2, radialTex([[0, 'rgba(120,214,206,.9)'], [0.45, 'rgba(96,196,196,.55)'], [1, 'rgba(60,160,180,0)']]), 0.9, WATER + 0.006));

    const tiles = [
      { q: 0, r: 0, top: 1.18, grass: true },
      { q: 1, r: 0, top: 0.94, grass: true },
      { q: 1, r: -1, top: 1.06, grass: true },
      { q: 0, r: -1, top: 0.62 },
      { q: -1, r: 0, top: 1.0, grass: true },
      { q: -1, r: 1, top: 0.86 },
      { q: 0, r: 1, top: 0.7, grass: true },
      { q: 2, r: -1, top: 0.5 },
      { q: -2, r: 1, top: 0.46 },
      { q: 2, r: 0, top: 0.4 }
    ];
    const foamTex = radialTex([[0, 'rgba(255,255,255,0)'], [0.78, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,.85)'], [0.92, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']]);
    const spots = [];
    const foam = [];
    tiles.forEach((t, i) => {
      const [x, z] = axial(t.q, t.r);
      const body = t.grass
        ? tile(t.top, t.top + 0.4, 0x5E8A3F, 0x6A5039, 0x2E261E)
        : tile(t.top, t.top + 0.4, [0xBBAB8B, 0xB5A585, 0xB09F7F][i % 3], 0x9C8667, 0x564B3C, true);
      body.position.set(x, 0, z);
      island.add(body);
      if (t.grass) spots.push({ x, z, top: t.top });
      const f = decal(R * 1.18, foamTex, 0.7, WATER + 0.01 + i * 0.0005);
      f.position.x = x;
      f.position.z = z;
      f.userData.phase = i * 0.7;
      island.add(f);
      foam.push(f);
    });
    island.userData.foam = foam;
    grass(spots);
    pebbles(tiles.filter(t => !t.grass));

    const [dx, dz] = axial(0, 1);
    const dock = makeDock();
    dock.position.set(dx * 0.15, 0.36, dz + 1.15);
    dock.rotation.y = 0.15;
    island.add(dock);

    [[3.4, 1.6, 0.3, 1], [-3.2, -1.1, 0.24, 2], [1.4, 3.3, 0.2, 3], [2.9, -2.4, 0.16, 4], [-2.4, 2.2, 0.12, 5]].forEach(([x, z, s, sd]) => {
      const r = rock(s, sd);
      r.position.set(x, WATER + s * 0.12, z);
      island.add(r);
    });

    // Hero banyan
    const origin = axial(0, 0);
    tree = new THREE.Group();
    tree.position.set(origin[0], 1.18, origin[1]);
    tree.userData.base = 1;
    island.add(tree);
    const banyan = makeBanyan();
    banyan.scale.setScalar(1.12);
    tree.add(banyan);
    apples = makeApples(appleCount, banyan, banyan.userData.lobes);
    tagHits(tree, 'hero', tree);
    pivots.push(tree);
    island.add(decalAO(origin[0], origin[1], 1.18, 0.95));

    const c1 = sitTree(makeCherry(21), 1, 0, 0.94, 0.95, 0.5, 'cherry');
    const c2 = sitTree(makeCherry(44), 0, 1, 0.7, 0.8, -0.3, 'cherry');
    petals = flutter(new THREE.ShapeGeometry(petalShape(), 2), 0xF6B8C6, 60, 0.08);
    petals.sources = [c1, c2];
    island.add(petals.mesh);
    burst = flutter(leafGeometry(), 0x4F8A45, 40);
    island.add(burst.mesh);

    stake = new THREE.Group();
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x9E7947, roughness: 0.9 })));
    post.position.y = 0.15;
    const mound = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5E4630, roughness: 1 })));
    mound.scale.y = 0.35;
    stake.add(post, mound);
    stake.position.set(origin[0], 1.18, origin[1]);
    stake.visible = false;
    island.add(stake);

    // "Ready to shake": soft gold light pooled at the roots, plus rising sparkles.
    halo = decal(0.98, radialTex([[0, 'rgba(255,236,190,0)'], [0.74, 'rgba(255,236,190,0)'], [0.84, 'rgba(255,232,180,.9)'], [0.88, 'rgba(235,190,105,1)'], [0.93, 'rgba(235,190,105,.25)'], [1, 'rgba(235,190,105,0)']]), 0.9, 1.192);
    halo.position.x = origin[0];
    halo.position.z = origin[1];
    island.add(halo);
    glow = decal(0.9, radialTex([[0, 'rgba(255,236,190,.35)'], [1, 'rgba(255,236,190,0)']]), 0.35, 1.188);
    glow.position.x = origin[0];
    glow.position.z = origin[1];
    island.add(glow);
    motes = makeMotes();
    motes.position.set(origin[0], 1.18, origin[1]);
    island.add(motes);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    const canvas = renderer.domElement;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', () => { hoverPivot = null; });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(treeHits, false);
    return hits.length ? hits[0].object.userData : null;
  }

  function onDown(e) {
    if (!planted || mode === 'shaking') return;
    const hit = pick(e);
    drag = { x: e.clientX, moved: 0, kind: hit ? hit.kind : null, lastX: e.clientX, lastT: performance.now() };
    spinVel = 0;
    if (!drag.kind) renderer.domElement.style.cursor = 'grabbing';
  }

  function onMove(e) {
    if (!drag) {
      const hit = planted ? pick(e) : null;
      hoverPivot = hit ? hit.pivot : null;
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    drag.moved = e.clientX - drag.x;
    if (drag.kind === 'hero' && ripe) {
      tree.rotation.z = Math.max(-0.2, Math.min(0.2, drag.moved * 0.0022));
    } else if (!drag.kind) {
      const now = performance.now();
      const d = (e.clientX - drag.lastX) * 0.005;
      island.rotation.y = Math.max(-1.6, Math.min(0.7, island.rotation.y + d));
      spinVel = d / Math.max(0.008, (now - drag.lastT) / 1000);
      drag.lastX = e.clientX;
      drag.lastT = now;
    }
  }

  function onUp() {
    if (!drag) return;
    const { kind, moved } = drag;
    drag = null;
    renderer.domElement.style.cursor = 'grab';
    if (kind === 'hero' && ripe) tree.rotation.z = 0;
    if (kind && Math.abs(moved) < 6 || kind === 'hero') {
      if (window.gardenPointerUp) window.gardenPointerUp(moved, kind);
    }
  }

  /* ---------- API ---------- */
  function sync(opts) {
    planted = !!opts.planted;
    ripe = !!opts.ripe;
    if (!tree) return;
    tree.visible = planted;
    stake.visible = !planted;
    const show = planted && ripe && mode !== 'shaking';
    halo.visible = glow.visible = motes.visible = show;
    if (mode !== 'shaking') apples.forEach(a => { a.mesh.visible = planted && ripe && a.phase !== 'gone'; });
  }

  function grow() {
    if (!tree) return;
    tree.scale.setScalar(0.05);
    growFrom = performance.now();
  }

  function startShake(dx, onApple) {
    if (mode === 'shaking') return;
    mode = 'shaking';
    appleCb = onApple;
    halo.visible = glow.visible = motes.visible = false;
    shake = { t0: performance.now(), sign: dx < 0 ? -1 : 1, amp: 0.2 };
    const now = performance.now();
    apples.forEach((a, i) => {
      if (a.phase === 'gone') return;
      a.mesh.visible = true;
      scene.attach(a.mesh);
      a.vel = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
      a.spin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
      a.phase = 'wait';
      a.start = now + 120 + i * 95;
      a.bounces = 0;
      a.ground = 1.18 + 0.05;
    });
    const top = tree.position.clone();
    for (let i = 0; i < 26; i++) {
      burst.emit(top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 0.7)), 1.19, 0.07, 0.2, 0.3);
    }
  }

  function stepApples(dt, now) {
    let live = false;
    apples.forEach(a => {
      if (a.phase === 'gone' || a.phase === 'hang') return;
      live = true;
      if (a.phase === 'wait') {
        if (now >= a.start) a.phase = 'fall';
        else return;
      }
      if (a.phase === 'fall') {
        a.vel.y -= 9.8 * dt;
        a.mesh.position.addScaledVector(a.vel, dt);
        a.mesh.rotation.x += a.spin.x * dt;
        a.mesh.rotation.y += a.spin.y * dt;
        a.mesh.rotation.z += a.spin.z * dt;
        if (a.mesh.position.y <= a.ground) {
          a.mesh.position.y = a.ground;
          a.vel.y *= -0.36;
          a.vel.x *= 0.7;
          a.vel.z *= 0.7;
          a.spin.multiplyScalar(0.6);
          a.bounces += 1;
          if (a.bounces >= 3 && Math.abs(a.vel.y) < 1.0) {
            a.phase = 'rest';
            a.vel.set(0, 0, 0);
          }
        }
      }
      if (a.phase === 'rest') {
        a.rest = (a.rest || 0) + dt;
        a.mesh.position.addScaledVector(a.vel.set(a.vel.x * 0.9, 0, a.vel.z * 0.9), dt);
        if (a.rest > 0.35) {
          a.phase = 'gone';
          const p = screenOf(a.mesh);
          a.mesh.visible = false;
          if (appleCb) appleCb(p.x, p.y);
        }
      }
    });
    if (!live && shake === null) mode = 'idle';
  }

  let petalClock = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.033, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (!renderer.domElement.offsetParent) return; // garden page hidden
    const t = now / 1000;
    timeU.value = t;

    // Camera: slow breathing drift so the scene never looks frozen.
    camera.position.set(camBase.x + Math.sin(t * 0.13) * 0.22, camBase.y + Math.sin(t * 0.17) * 0.1, camBase.z + Math.cos(t * 0.11) * 0.15);
    camera.lookAt(lookAt);

    // Island spin with inertia after a drag.
    if (!drag && Math.abs(spinVel) > 0.001) {
      island.rotation.y = Math.max(-1.6, Math.min(0.7, island.rotation.y + spinVel * dt));
      spinVel *= Math.pow(0.04, dt);
    }

    if (growFrom) {
      const p = Math.min(1, (now - growFrom) / 1800);
      const s = p >= 1 ? 1 : 1 - Math.pow(1 - p, 2) * Math.cos(p * Math.PI * 1.2);
      tree.scale.setScalar(Math.max(0.05, s));
      if (p >= 1) growFrom = 0;
      if (p < 0.6 && Math.random() < 0.5) burst.emit(tree.position.clone().add(new THREE.Vector3(0, 0.5 + Math.random() * 0.6, 0)), 1.19, 0.06, 0.9, 0.6);
    }

    if (shake) {
      const p = Math.min(1, (now - shake.t0) / 1400);
      tree.rotation.z = shake.sign * shake.amp * Math.exp(-3 * p) * Math.sin(p * Math.PI * 7);
      tree.rotation.x = shake.amp * 0.4 * Math.exp(-3 * p) * Math.sin(p * Math.PI * 5.5);
      if (p >= 1) {
        tree.rotation.set(0, 0, 0);
        shake = null;
      }
    } else if (mode !== 'shaking' && planted && !drag) {
      tree.rotation.z = Math.sin(t * 1.1) * 0.01;
    }
    pivots.forEach((p, i) => {
      if (p !== tree) p.rotation.z = Math.sin(t + i * 1.7) * 0.012;
      const target = p === hoverPivot ? 1.035 : 1;
      p.userData.base += (target - p.userData.base) * Math.min(1, dt * 10);
      if (p !== tree || !growFrom) {
        const k = p.userData.base;
        if (p === tree) tree.scale.setScalar(k);
        else p.scale.setScalar(k);
      }
    });

    // Water and foam
    water.material.normalMap.offset.set(t * 0.006, t * 0.004);
    island.userData.foam.forEach(f => {
      f.material.opacity = 0.45 + Math.sin(t * 1.3 + f.userData.phase) * 0.25;
      f.scale.setScalar(1 + Math.sin(t * 1.3 + f.userData.phase) * 0.02);
    });

    // Petals drifting off the cherry blossoms.
    petalClock += dt;
    if (petalClock > 0.35) {
      petalClock = 0;
      const src = petals.sources[Math.floor(Math.random() * petals.sources.length)];
      petals.emit(src.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.75 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5)), src.position.y + 0.01, 0.035, 0.3, 0);
    }
    petals.step(dt, now);
    burst.step(dt, now);

    if (halo.visible) {
      const k = Math.sin(t * 2.4) * 0.5 + 0.5;
      halo.material.opacity = 0.5 + k * 0.45;
      halo.scale.setScalar(0.97 + k * 0.05);
      glow.material.opacity = 0.15 + k * 0.2;
      const pos = motes.geometry.attributes.position;
      motes.userData.seeds.forEach(([a, r, ph, sp], i) => {
        const u = (t * sp * 0.35 + ph) % 1;
        pos.setXYZ(i, Math.cos(a + t * 0.3) * r, 0.05 + u * 1.3, Math.sin(a + t * 0.3) * r);
      });
      pos.needsUpdate = true;
      motes.material.opacity = 0.9;
      motes.material.size = 0.07 + k * 0.03;
    }

    if (mode === 'shaking') stepApples(dt, now);
    renderer.render(scene, camera);
  }

  window.Garden3D = { mount, sync, grow, shake: startShake, resize };
})();
