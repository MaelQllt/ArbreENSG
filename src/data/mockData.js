// Données fictives (~400 étudiants, 7 promotions) pour développer l'interface.
// À remplacer par ton vrai jeu de données, au format décrit dans lib/lineage.js.

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRENOMS = ['Léa', 'Hugo', 'Emma', 'Louis', 'Chloé', 'Jules', 'Manon', 'Arthur', 'Camille', 'Lucas',
  'Inès', 'Nathan', 'Sarah', 'Théo', 'Clara', 'Paul', 'Jade', 'Noé', 'Zoé', 'Tom'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier'];
const FILIERES = ['Filière A', 'Filière B', 'Filière C', 'Filière D']; // exemples : à remplacer par les vraies filières

const FIRST_PROMO = 2020;
const PROMO_COUNT = 7;
const PER_PROMO = 58;

const random = mulberry32(42);
const pick = (list) => list[Math.floor(random() * list.length)];

const nodes = [];
const links = [];

for (let p = 0; p < PROMO_COUNT; p++) {
  for (let i = 0; i < PER_PROMO; i++) {
    const id = `s-${p}-${i}`;
    nodes.push({
      id,
      name: `${pick(PRENOMS)} ${pick(NOMS)}`,
      promo: FIRST_PROMO + p,
      // les filières n'existent qu'à partir d'IT3 (promos 2024 et antérieures en 2026-2027)
      filiere: p <= 4 ? pick(FILIERES) : undefined,
    });
    if (p === 0) continue;
    // 1 parrain/marraine issu de la promo précédente, et 1 chance sur 4 d'en avoir un second
    const first = `s-${p - 1}-${Math.floor(random() * PER_PROMO)}`;
    links.push({ source: first, target: id });
    if (random() < 0.25) {
      const second = `s-${p - 1}-${Math.floor(random() * PER_PROMO)}`;
      if (second !== first) links.push({ source: second, target: id });
    }
  }
}

export default { nodes, links };
