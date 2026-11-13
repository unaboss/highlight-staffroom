/* The flat, line-drawn school (viewBox 0 0 1200 600), ported from app/static/ft/school.js.
   Windows carry data-room / data-col so agents, classes and course statuses can light them. */
import { useEffect, useRef } from "react";

const XS = [184, 256, 328, 400, 752, 824, 896, 968];
const TOP = ["principal", "librarian", "librarian", "teacher", "examiner", "examiner", "observer", "counsellor"];

export function schoolMarkup(id: string): string {
  const S = 'pathLength="1"', F = 'class="f"', out: string[] = [];
  const tree = (dx: number) => out.push(
    `<line ${S} x1="${92 + dx}" y1="540" x2="${92 + dx}" y2="466"/>`,
    `<line ${S} x1="${92 + dx}" y1="494" x2="${78 + dx}" y2="482"/>`,
    `<line ${S} x1="${92 + dx}" y1="486" x2="${104 + dx}" y2="476"/>`,
    `<path ${S} ${F} transform="translate(${dx} 0)" d="M60 458 A20 20 0 0 1 68 421 A27 27 0 0 1 116 418 A20 20 0 0 1 124 458 Q92 470 60 458 Z"/>`);
  tree(0); tree(1016);
  out.push(`<rect ${S} ${F} x="160" y="296" width="330" height="244"/>`, `<rect ${S} ${F} x="710" y="296" width="330" height="244"/>`,
    `<rect ${S} ${F} x="150" y="284" width="340" height="12"/>`, `<rect ${S} ${F} x="710" y="284" width="340" height="12"/>`,
    `<line ${S} x1="160" y1="394" x2="490" y2="394"/>`, `<line ${S} x1="710" y1="394" x2="1040" y2="394"/>`);
  ([[320, (i: number) => TOP[i]], [410, () => "class"]] as const).forEach(([y, room], row) => XS.forEach((x, i) => out.push(
    `<g class="win" data-room="${room(i)}" data-col="${i}" data-row="${row}">
      <rect class="glass" x="${x}" y="${y}" width="48" height="52" rx="2"/>
      <rect ${S} x="${x}" y="${y}" width="48" height="52" rx="2"/>
      <line ${S} x1="${x + 24}" y1="${y}" x2="${x + 24}" y2="${y + 52}"/>
      <line ${S} x1="${x}" y1="${y + 22}" x2="${x + 48}" y2="${y + 22}"/>
      <line ${S} x1="${x - 5}" y1="${y + 58}" x2="${x + 53}" y2="${y + 58}"/></g>`)));
  out.push(`<line ${S} x1="600" y1="84" x2="600" y2="34"/>`, `<path ${S} class="flag" d="M600 36 c14-7 26 7 40 0 v22 c-14 7-26-7-40 0 z"/>`,
    `<rect ${S} ${F} x="578" y="112" width="44" height="58"/>`, `<path ${S} d="M589 162 v-26 a11 11 0 0 1 22 0 v26"/>`,
    `<polygon ${S} ${F} points="566,112 600,82 634,112"/>`,
    `<rect ${S} ${F} x="480" y="246" width="240" height="294"/>`, `<polygon ${S} ${F} points="448,234 600,150 752,234"/>`,
    `<polyline ${S} points="482,226 600,166 718,226"/>`, `<rect ${S} ${F} x="458" y="234" width="284" height="14"/>`,
    `<circle ${S} cx="600" cy="200" r="19"/>`, `<line ${S} x1="600" y1="200" x2="600" y2="188"/>`, `<line ${S} x1="600" y1="200" x2="609" y2="205"/>`,
    `<rect ${S} x="522" y="262" width="156" height="30" rx="3"/>`, `<text x="600" y="282" text-anchor="middle" class="sign">STAFFROOM</text>`,
    `<rect ${S} x="490" y="300" width="16" height="240"/>`, `<rect ${S} x="694" y="300" width="16" height="240"/>`,
    `<line ${S} x1="486" y1="300" x2="510" y2="300"/>`, `<line ${S} x1="690" y1="300" x2="714" y2="300"/>`,
    `<rect ${S} x="520" y="320" width="28" height="140" rx="14"/>`, `<rect ${S} x="652" y="320" width="28" height="140" rx="14"/>`,
    `<path ${S} d="M562 516 v-74 a38 38 0 0 1 76 0 v74"/>`, `<line ${S} x1="600" y1="404" x2="600" y2="516"/>`,
    `<line ${S} x1="552" y1="516" x2="648" y2="516"/>`, `<line ${S} x1="542" y1="524" x2="658" y2="524"/>`, `<line ${S} x1="532" y1="532" x2="668" y2="532"/>`,
    `<line ${S} x1="30" y1="540" x2="1170" y2="540"/>`, `<path ${S} d="M552 540 L508 598"/>`, `<path ${S} d="M648 540 L692 598"/>`);
  const h = `${id}-hatch`;
  const defs = `<defs><pattern id="${h}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#27272a"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a1a1aa" stroke-width="1.6"/></pattern></defs>`;
  return `<svg id="${id}" class="school" viewBox="0 0 1200 600" aria-hidden="true" style="--hatch:url(#${h})">${defs}${out.join("")}</svg>`;
}

/** The school drawing, drawn in stroke by stroke, with optional per-column statuses. */
export function School({ id, columns, lit = 0, className }: { id: string; columns?: string[]; lit?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const svg = host.current?.querySelector("svg");
    if (!svg) return;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svg.querySelectorAll<SVGElement>("[pathLength]").forEach((el, i) => {
        el.style.strokeDasharray = "1"; el.style.strokeDashoffset = "1";
        el.style.transition = `stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1) ${i * 25}ms`;
        requestAnimationFrame(() => requestAnimationFrame(() => (el.style.strokeDashoffset = "0")));
      });
    }
    const timers: number[] = [];
    columns?.forEach((st, i) => svg.querySelectorAll(`.win[data-col="${i}"]`).forEach((w, k) =>
      timers.push(window.setTimeout(() => w.classList.add(st), 900 + i * 120 + k * 60))));
    svg.querySelectorAll('.win[data-room="class"]').forEach((w, i) => w.classList.toggle("on", i < lit));
    return () => timers.forEach(clearTimeout);
  }, [columns, lit]);
  return <div ref={host} className={className} dangerouslySetInnerHTML={{ __html: schoolMarkup(id) }} />;
}

/** Light an agent's room windows for a moment. */
export function lightRoom(svgId: string, room: string, ms = 3200) {
  document.querySelectorAll<SVGGElement>(`#${svgId} .win[data-room="${room}"]`).forEach((w, i) => {
    w.style.setProperty("--lit", i % 2 ? "#ff3d9a" : "#e6197f");
    w.classList.add("on");
    window.setTimeout(() => w.classList.remove("on"), ms);
  });
}
