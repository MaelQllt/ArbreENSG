import { promoStyle, shapePolygon } from '../theme';

/** Symbole d'une promo (même forme, même couleur que dans le graphe). */
export default function ShapeSwatch({ promo, size = 16 }) {
  const { color, shape, stroke } = promoStyle(promo);
  const c = size / 2;
  const points = shapePolygon(shape, c, c, size * 0.34).map((p) => p.join(',')).join(' ');
  return (
    <svg className="swatch" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <polygon points={points} fill={color} stroke={stroke} strokeWidth="1" strokeLinejoin="miter" />
    </svg>
  );
}
