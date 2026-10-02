import { useMemo } from 'react';
import { COLORS } from '../theme';

// Fond inspiré des courbes topographiques du logo : traits superposés,
// du sable (en haut) vers le violet (en bas), de plus en plus épais.
const W = 1600;
const H = 900;
const LINES = 15;

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
};

function buildLines() {
  const rand = mulberry32(11);
  // Quelques ruptures discrètes gardent le caractère de la ligne sans la rendre dentelée.
  const xs = [];
  for (let x = -80; x < W + 80; x += 90 + rand() * 110) xs.push(x);
  // Profil commun à toutes les lignes pour obtenir des courbes proches et parallèles.
  const ridge = xs.map((x) => {
    const u = x / W;
    return Math.sin(u * Math.PI * 1.25 + 0.5) * 62
      + Math.sin(u * Math.PI * 3.1 + 0.7) * 16
      + (rand() - 0.5) * 24;
  });

  return Array.from({ length: LINES }, (_, i) => {
    const t = i / (LINES - 1);
    const base = H * (0.14 + 0.8 * t);
    const points = xs
      .map((x, k) => `${x.toFixed(0)},${(base + ridge[k] * (0.55 + 0.9 * t) + (rand() - 0.5) * 7).toFixed(0)}`)
      .join(' ');
    return {
      points,
      stroke: mix(COLORS.sand, COLORS.violet, Math.min(1, t * 1.15)),
      width: 0.9 + 2.4 * t,
      opacity: 0.2 + 0.38 * t,
    };
  });
}

export default function TopoBackground() {
  const lines = useMemo(buildLines, []);
  return (
    <svg
      className="topo"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {lines.map((l, i) => (
        <polyline
          key={i}
          points={l.points}
          fill="none"
          stroke={l.stroke}
          strokeWidth={l.width}
          strokeOpacity={l.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
