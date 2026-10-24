import { studentSlug } from './appHash';
import { buildIndex } from './lineage';

// Signalements automatiques affichés aux superadmins avec les requêtes.
// Ce sont des points à vérifier, pas des erreurs : une passerelle ou une boucle
// peut être voulue, d'où la possibilité de les ignorer. Chaque signalement a une
// clé construite sur les noms (les identifiants changent d'un import à l'autre),
// qui sert à retenir les signalements ignorés dans Supabase.

export const QUALITY_TYPES = {
  duplicate: 'Doublons probables',
  younger: 'Parrain ou marraine plus jeune que son fillot',
  loop: 'Boucles de parrainage',
  isolated: 'Étudiants isolés, sans parrain ni fillot',
};

const comparable = (name) => studentSlug(name).replaceAll('-', ' ');

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

const promoYears = (student) => [
  student.promo,
  ...(student.additionalAffiliations ?? []).map(({ promo }) => promo),
].map(Number).filter(Number.isFinite);

function findLoops(nodes, index) {
  const state = new Map();
  const stack = [];
  const loops = new Map();
  const visit = (id) => {
    state.set(id, 'open');
    stack.push(id);
    for (const next of index.children.get(id)) {
      if (state.get(next) === 'open') {
        const loop = stack.slice(stack.indexOf(next));
        const key = loop.map((loopId) => studentSlug(index.byId.get(loopId).name)).sort().join('|');
        if (!loops.has(key)) loops.set(key, loop);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 'done');
  };
  nodes.forEach((node) => {
    if (!state.has(node.id)) visit(node.id);
  });
  return [...loops.entries()];
}

/** Liste des signalements, du plus grave au moins grave. */
export function findDataQualityIssues(data) {
  const index = buildIndex(data);
  const issues = [];
  const slug = (id) => studentSlug(index.byId.get(id).name);

  // Deux noms à deux lettres près (accents, majuscules et tirets ignorés).
  const names = data.nodes.map((node) => ({ node, name: comparable(node.name) }));
  names.forEach((first, position) => {
    names.slice(position + 1).forEach((second) => {
      if (Math.min(first.name.length, second.name.length) < 8) return;
      if (Math.abs(first.name.length - second.name.length) > 2) return;
      if (editDistance(first.name, second.name) > 2) return;
      const ids = [first.node.id, second.node.id];
      issues.push({ type: 'duplicate', key: 'doublon:' + ids.map(slug).sort().join('|'), studentIds: ids });
    });
  });

  // Les appartenances secondaires comptent : un étudiant passé par LG21 peut
  // parrainer quelqu'un de LG22 même s'il est en ING24.
  data.links.forEach(({ source, target }) => {
    const parent = index.byId.get(source);
    const child = index.byId.get(target);
    if (!parent || !child) return;
    if (Math.min(...promoYears(parent)) <= Math.max(...promoYears(child))) return;
    issues.push({
      type: 'younger',
      key: `parrain-plus-jeune:${slug(source)}>${slug(target)}`,
      studentIds: [source, target],
    });
  });

  findLoops(data.nodes, index).forEach(([key, loop]) => {
    issues.push({ type: 'loop', key: 'boucle:' + key, studentIds: loop });
  });

  data.nodes.forEach((node) => {
    if (index.parents.get(node.id).length || index.children.get(node.id).length) return;
    issues.push({ type: 'isolated', key: 'isole:' + slug(node.id), studentIds: [node.id] });
  });

  return issues;
}
