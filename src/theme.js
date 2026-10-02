// Charte graphique Géodata Paris
export const COLORS = {
  blue: '#2b317f',   // bleu institutionnel
  yellow: '#ded41f', // jaune
  sand: '#fac18a',   // sable doré
  violet: '#38235b', // violet foncé
  paper: '#ffffff',  // neutre pour les textes et la fiche
};

const ACCENTS = [COLORS.yellow, COLORS.sand, COLORS.violet];
const SHAPES = ['square', 'diamond', 'triangle'];

// Couleur du texte à poser sur chaque accent
const ON_COLOR = {
  [COLORS.yellow]: COLORS.blue,
  [COLORS.sand]: COLORS.violet,
  [COLORS.violet]: COLORS.sand,
};

// Le symbole dépend de l'année de promo (et non de l'ordre dans les données) :
// il ne change donc pas quand une nouvelle promo est ajoutée.
const BASE_YEAR = 2020;
const mod = (n, m) => ((n % m) + m) % m;

/** 3 couleurs x 3 formes = 9 symboles uniques pour 9 promotions consécutives. */
export function promoStyle(promo) {
  const i = promo - BASE_YEAR;
  const color = ACCENTS[mod(i, 3)];
  return {
    color,
    shape: SHAPES[mod(Math.floor(i / 3), 3)],
    onColor: ON_COLOR[color],
    // le violet se perd sur le fond bleu : on le cerne de sable
    stroke: color === COLORS.violet ? COLORS.sand : COLORS.blue,
  };
}

/** Sommets d'une forme, partagés entre le canvas (graphe) et le SVG (légende, fiche). */
export function shapePolygon(shape, cx, cy, r) {
  if (shape === 'square') {
    return [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  }
  if (shape === 'diamond') {
    const d = r * 1.35;
    return [[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]];
  }
  return [[cx, cy - r * 1.3], [cx + r * 1.25, cy + r], [cx - r * 1.25, cy + r]];
}
