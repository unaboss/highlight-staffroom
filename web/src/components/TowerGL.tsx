/* The student's tower as a real 3D building (three.js), in the same pink line style as the login
   school: one storey per floor built, glowing windows, a cornice and a roof with a flag when the
   course is done. Turns slowly; holds a three-quarter view under reduced motion. */
import { useEffect, useRef } from "react";
import * as THREE from "three";

const INK = 0xff9ccb, FILL = 0x0c0b0e, LIT = [0xffd1e6, 0xff9ccb, 0xff3d9a, 0xe6197f];

export default function TowerGL({ floors, built = floors, done, spin, className }: { floors: number; built?: number; done: boolean; spin: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    const tower = new THREE.Group();
    scene.add(tower);

    const fill = new THREE.MeshBasicMaterial({ color: FILL, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const ink = new THREE.LineBasicMaterial({ color: INK });
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, fill); m.position.set(x, y, z);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), ink); e.position.copy(m.position);
      tower.add(m, e);
    };

    const W = 2.6, D = 2.6, H = 0.62, n = Math.max(1, floors);
    // plinth and steps
    add(new THREE.BoxGeometry(W + 0.5, 0.16, D + 0.5), 0, 0.08, 0);
    add(new THREE.BoxGeometry(0.9, 0.08, 0.3), 0, 0.04, D / 2 + 0.4);
    // storeys: a box each, with a thin ledge and a row of lit windows on every face
    const winGeo = new THREE.PlaneGeometry(0.32, 0.34);
    for (let i = 0; i < n; i++) {
      const y = 0.16 + i * H + H / 2;
      add(new THREE.BoxGeometry(W, H, D), 0, y, 0);
      add(new THREE.BoxGeometry(W + 0.1, 0.05, D + 0.1), 0, y + H / 2, 0);
      // built storeys glow; the ones still to climb are outlines with dark windows
      const colour = i < built ? LIT[Math.min(LIT.length - 1, Math.floor((i / Math.max(1, n - 1)) * (LIT.length - 1)))] : 0x2a1720;
      const mat = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
      for (let f = 0; f < 4; f++) {
        for (let k = -1; k <= 1; k++) {
          const w = new THREE.Mesh(winGeo, mat);
          const off = k * 0.62, out = W / 2 + 0.004;
          const a = (f * Math.PI) / 2;
          w.position.set(Math.sin(a) * out + Math.cos(a) * off, y - 0.02, Math.cos(a) * out - Math.sin(a) * off);
          w.rotation.y = a;
          tower.add(w);
        }
      }
    }
    const top = 0.16 + n * H;
    // cornice and roof; a flag when the whole course is done
    add(new THREE.BoxGeometry(W + 0.3, 0.14, D + 0.3), 0, top + 0.07, 0);
    const roof = new THREE.ConeGeometry((W + 0.2) * 0.72, 0.9, 4, 1); roof.rotateY(Math.PI / 4);
    add(roof, 0, top + 0.14 + 0.45, 0);
    if (done) {
      const pole = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, top + 0.9, 0), new THREE.Vector3(0, top + 1.9, 0)]);
      tower.add(new THREE.LineSegments(pole, ink));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), new THREE.MeshBasicMaterial({ color: 0xff3d9a, side: THREE.DoubleSide }));
      flag.position.set(0.3, top + 1.72, 0); tower.add(flag);
    }
    // ground ring
    const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(2.6, 48)), new THREE.LineBasicMaterial({ color: 0xe6197f, transparent: true, opacity: 0.5 }));
    ring.rotation.x = -Math.PI / 2; tower.add(ring);

    // frame the whole building
    const total = top + (done ? 2 : 1.1);
    const fit = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      const dist = Math.max(total / 2 / Math.tan((camera.fov * Math.PI) / 360), (W * 1.8) / camera.aspect / Math.tan((camera.fov * Math.PI) / 360) / 2) * 1.02 + 1;
      camera.position.set(0, total * 0.62, dist);
      camera.lookAt(0, total / 2, 0);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);

    let raf = 0, alive = true;
    const frame = (now: number) => {
      if (!alive) return;
      tower.rotation.y = spin ? now / 1000 * 0.35 : -0.6;
      renderer.render(scene, camera);
      if (spin) raf = requestAnimationFrame(frame);
    };
    frame(performance.now());
    const onVis = () => { if (!spin) return; cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o: any) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m?.dispose?.()); });
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, [floors, built, done, spin]);

  return <div ref={host} className={className} />;
}
