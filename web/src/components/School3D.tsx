/* The login's school as a 3D line model (three.js): the same front-view school as the flat drawing,
   built from boxes and prisms with pink edges over a near-black fill, so hidden lines are occluded.
   It draws itself in, faces front and floats a little; windows can flash on cue. */
import { useEffect, useRef } from "react";
import * as THREE from "three";

const INK = 0xff9ccb, FILL = 0x0c0b0e, STAFF = 0xe6197f, STAFF2 = 0xff3d9a, CLASS = 0xffd1e6;
const px = (x: number) => (x - 600) / 100;          // flat-drawing pixels -> world units (x)
const py = (y: number) => (540 - y) / 100;          // flat-drawing pixels -> world units (y, ground at 0)

type Win = { mesh: THREE.Mesh; color: number };

export default function School3D({ flash, className, onReady }: { flash: boolean; className?: string; onReady?: () => void }) {
  const ready = useRef(onReady);
  ready.current = onReady;
  const host = useRef<HTMLDivElement>(null);
  const wins = useRef<Win[]>([]);

  useEffect(() => {
    const el = host.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    camera.position.set(0, 2.4, 17);
    camera.lookAt(0, 2.25, 0);
    const school = new THREE.Group();
    scene.add(school);

    const fillMat = new THREE.MeshBasicMaterial({ color: FILL, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lines: THREE.LineSegments[] = [];
    const lineMat = () => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.95 });
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, edgeAngle = 1) => {
      const mesh = new THREE.Mesh(geo, fillMat);
      mesh.position.set(x, y, z);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, edgeAngle), lineMat());
      edges.position.copy(mesh.position);
      school.add(mesh, edges);
      lines.push(edges);
      return mesh;
    };
    const box = (x0: number, y0: number, x1: number, y1: number, depth: number, z = 0) =>
      add(new THREE.BoxGeometry(px(x1) - px(x0), py(y0) - py(y1), depth), (px(x0) + px(x1)) / 2, (py(y0) + py(y1)) / 2, z);
    const prism = (pts: [number, number][], depth: number, z = 0) => {
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(px(x), py(y))));
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.translate(0, 0, -depth / 2);
      return add(geo, 0, 0, z);
    };
    const line = (pts: [number, number, number][]) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const l = new THREE.LineSegments(g, lineMat());
      school.add(l);
      lines.push(l);
    };

    // wings, parapets, floor lines
    const WD = 1.5, CD = 1.9;
    box(160, 296, 490, 540, WD, -0.1); box(710, 296, 1040, 540, WD, -0.1);
    box(150, 284, 490, 296, WD + 0.1, -0.1); box(710, 284, 1050, 296, WD + 0.1, -0.1);
    const wf = WD / 2 - 0.1 + 0.002;
    line([[px(160), py(394), wf], [px(490), py(394), wf], [px(710), py(394), wf], [px(1040), py(394), wf]]);
    // central block, cornice, pediment, bell tower and roof
    box(480, 246, 720, 540, CD, 0.15);
    box(458, 234, 742, 248, CD + 0.15, 0.15);
    prism([[448, 234], [600, 150], [752, 234]], CD + 0.1, 0.15);
    box(578, 112, 622, 170, 0.5, 0.15);
    const roof = new THREE.ConeGeometry(0.48, py(82) - py(112), 4, 1);
    roof.rotateY(Math.PI / 4);
    add(roof, 0, (py(82) + py(112)) / 2, 0.15);
    line([[0, py(84), 0.15], [0, py(34), 0.15]]);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22), new THREE.MeshBasicMaterial({ color: STAFF, side: THREE.DoubleSide }));
    flag.position.set(0.21, py(47), 0.15);
    school.add(flag);

    const cf = 0.15 + CD / 2 + 0.003;                      // front face of the central block
    // pilasters and capitals
    box(490, 300, 506, 540, 0.18, cf + 0.06); box(694, 300, 710, 540, 0.18, cf + 0.06);
    // clock on the pediment
    const pedFront = 0.15 + (CD + 0.1) / 2 + 0.003;
    const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(0.19, 28)), lineMat());
    ring.position.set(0, py(200), pedFront); school.add(ring); lines.push(ring);
    line([[0, py(200), pedFront], [0, py(188), pedFront], [0, py(200), pedFront], [0.09, py(205), pedFront]]);
    // sign: STAFFROOM on a small canvas texture
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 96;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#0c0b0e"; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = "#ff9ccb"; g.lineWidth = 6; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = "#ff9ccb"; g.font = "600 44px Inter, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    (g as any).letterSpacing = "14px"; g.fillText("STAFFROOM", 262, 50);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    sign.position.set(0, py(277), cf + 0.004); school.add(sign);
    // door arch and steps
    const door = new THREE.Shape();
    door.moveTo(px(562), py(516)); door.lineTo(px(562), py(442)); door.absarc(0, py(442), 0.38, Math.PI, 0, true); door.lineTo(px(638), py(516));
    const doorLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ShapeGeometry(door)), lineMat());
    doorLine.position.z = cf + 0.004; school.add(doorLine); lines.push(doorLine);
    line([[0, py(404), cf + 0.004], [0, py(516), cf + 0.004]]);
    box(552, 516, 648, 524, 0.3, cf + 0.15); box(542, 524, 658, 532, 0.5, cf + 0.25); box(532, 532, 668, 540, 0.7, cf + 0.35);

    // windows: glowing panes (staff rooms on top, classrooms below), with mullions and sills
    const XS = [184, 256, 328, 400, 752, 824, 896, 968];
    wins.current = [];
    [[320, STAFF], [410, CLASS]].forEach(([y, colour], row) => XS.forEach((x, i) => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.52), new THREE.MeshBasicMaterial({ color: FILL, transparent: true }));
      pane.position.set(px(x + 24), py(y + 26), wf + 0.001);
      school.add(pane);
      wins.current.push({ mesh: pane, color: row === 0 && i % 2 ? STAFF2 : (colour as number) });
      const z = wf + 0.002, x0 = px(x), x1 = px(x + 48), y0 = py(y), y1 = py(y + 52), xm = px(x + 24), ym = py(y + 22);
      line([[x0, y0, z], [x1, y0, z], [x1, y0, z], [x1, y1, z], [x1, y1, z], [x0, y1, z], [x0, y1, z], [x0, y0, z],
            [xm, y0, z], [xm, y1, z], [x0, ym, z], [x1, ym, z], [px(x - 5), py(y + 58), z], [px(x + 53), py(y + 58), z]]);
    }));
    // tall windows either side of the door
    [520, 652].forEach((x) => {
      const s = new THREE.Shape();
      s.moveTo(px(x), py(460)); s.lineTo(px(x), py(334)); s.absarc(px(x + 14), py(334), 0.14, Math.PI, 0, true); s.lineTo(px(x + 28), py(460));
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ShapeGeometry(s)), lineMat());
      l.position.z = cf + 0.004; school.add(l); lines.push(l);
    });
    // trees and ground
    [-5.08, 5.08].forEach((x) => {
      add(new THREE.CylinderGeometry(0.03, 0.04, 0.74, 6), x, 0.37, 0.4);
      add(new THREE.IcosahedronGeometry(0.34, 0), x, 1.05, 0.4);
    });
    line([[-5.7, 0, 1.4], [5.7, 0, 1.4], [-5.7, 0, -1.2], [5.7, 0, -1.2]]);

    // draw-in: reveal each line set over 2.4s, staggered
    const totals = lines.map((l) => (l.geometry.index ? l.geometry.index.count : l.geometry.attributes.position.count));
    const t0 = performance.now();
    const drawIn = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / 2400);
      lines.forEach((l, i) => {
        const start = (i / lines.length) * 0.6, local = Math.min(1, Math.max(0, (k - start) / 0.4));
        l.geometry.setDrawRange(0, Math.floor(totals[i] * local / 2) * 2);
      });
      return k >= 1;
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || w * 0.62;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    let raf = 0, running = true;
    const loop = (now: number) => {
      if (!running) return;
      drawIn(now);
      const t = now / 1000;
      if (reduce) { school.rotation.y = 0; school.position.y = 0; }
      else { school.rotation.y = 0; school.position.y = Math.sin(t * 0.9) * 0.04; }   // faces front and holds still (dev note 1)
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop(performance.now());                     // first frame right away, then animation frames
    ready.current?.();                           // the model is built and drawn once
    const onVis = () => { running = !document.hidden; if (running) raf = requestAnimationFrame(loop); else cancelAnimationFrame(raf); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o: any) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m?.dispose?.()); });
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  // windows flash one by one on cue, then settle back
  useEffect(() => {
    if (!flash) return;
    const timers: number[] = [];
    wins.current.forEach((w, i) => timers.push(window.setTimeout(() => (w.mesh.material as THREE.MeshBasicMaterial).color.setHex(w.color), i * 35)));
    timers.push(window.setTimeout(() => wins.current.forEach((w) => (w.mesh.material as THREE.MeshBasicMaterial).color.setHex(FILL)), wins.current.length * 35 + 500));
    return () => timers.forEach(clearTimeout);
  }, [flash]);

  return <div ref={host} className={className} aria-hidden="true" />;
}
