/**
 * Modèle de données interne :
 * {
 *   nodes: [{ id, name, promo, code?, filiere?, bio? }],
 *   links: [{ source: <id du parrain/de la marraine>, target: <id du fillot/de la fillotte> }]
 * }
 * Un étudiant peut avoir plusieurs parrains et plusieurs fillots.
 * Les liens forment en principe une hiérarchie, mais une boucle reste possible :
 * elle est signalée par une confirmation à la création, jamais bloquée. Les
 * ensembles `up` et `down` peuvent alors se recouvrir, et `isLinkInLineage` reste
 * correct puisqu'il accepte l'un ou l'autre. Seuls les deux compteurs de la fiche
 * se recoupent, ce qui est assumé.
 * (Le plus simple pour alimenter l'app : un CSV, voir lib/csv.js et public/students.example.csv.)
 */

export function buildIndex(raw) {
  const byId = new Map();
  const parents = new Map();
  const children = new Map();
  raw.nodes.forEach((n) => {
    byId.set(n.id, n);
    parents.set(n.id, []);
    children.set(n.id, []);
  });
  raw.links.forEach(({ source, target }) => {
    parents.get(target).push(source);
    children.get(source).push(target);
  });
  return { byId, parents, children };
}

/** Prépare une copie des données pour react-force-graph (qui mute ses objets). */
export function prepareGraph(raw) {
  const promos = [...new Set(raw.nodes.map((n) => n.promo))].sort((a, b) => a - b);
  const index = buildIndex(raw);
  return {
    promos,
    index,
    graphData: {
      nodes: raw.nodes.map((n) => {
        const promoIndex = promos.indexOf(n.promo);
        const promoY = (promoIndex - (promos.length - 1) / 2) * 138;
        return {
          ...n,
          promoIndex,
          promoY,
          degree: index.parents.get(n.id).length + index.children.get(n.id).length,
        };
      }),
      links: raw.links.map((l) => ({ ...l })),
    },
  };
}

function walk(start, adjacency) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/** Lignée complète : tous les ascendants (parrains remontants) et descendants (fillots). */
export function getLineage(index, id) {
  const ancestors = walk(id, index.parents);
  const descendants = walk(id, index.children);
  return {
    ancestors,
    descendants,
    up: new Set([...ancestors, id]),
    down: new Set([...descendants, id]),
    nodeIds: new Set([id, ...ancestors, ...descendants]),
  };
}

const idOf = (endpoint) => (typeof endpoint === 'object' ? endpoint.id : endpoint);

/**
 * Un lien fait partie de la lignée s'il relie deux ascendants (ou l'étudiant),
 * ou deux descendants (ou l'étudiant).
 */
export function isLinkInLineage(link, lineage) {
  const s = idOf(link.source);
  const t = idOf(link.target);
  return (lineage.up.has(s) && lineage.up.has(t)) || (lineage.down.has(s) && lineage.down.has(t));
}

/**
 * Chemin le plus court entre deux étudiants, en suivant les liens dans les deux
 * sens (on peut remonter vers un parrain puis redescendre vers un autre fillot).
 * Renvoie la liste des identifiants, des deux bouts compris, ou [] sans lien.
 */
export function findRelationPath(index, fromId, toId) {
  if (!index.byId.has(fromId) || !index.byId.has(toId)) return [];
  if (fromId === toId) return [fromId];
  const previous = new Map([[fromId, null]]);
  const queue = [fromId];
  for (let cursor = 0; cursor < queue.length && !previous.has(toId); cursor += 1) {
    const current = queue[cursor];
    for (const next of [...index.parents.get(current), ...index.children.get(current)]) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(toId)) return [];
  const path = [];
  for (let current = toId; current !== null; current = previous.get(current)) path.push(current);
  return path.reverse();
}

/** 'parrain' si `fromId` est parrain/marraine de `toId`, 'fillot' dans l'autre sens. */
export function relationKind(index, fromId, toId) {
  return index.children.get(fromId)?.includes(toId) ? 'parrain' : 'fillot';
}

/**
 * Même forme que getLineage, pour que le graphe surligne un chemin comme une
 * lignée. Un plus court chemin n'a pas de raccourci entre deux de ses étudiants
 * non consécutifs : surligner les liens dont les deux bouts sont sur le chemin
 * revient donc à surligner exactement les étapes du chemin.
 */
export function relationHighlight(path) {
  const ids = new Set(path);
  return { ancestors: new Set(), descendants: new Set(), up: ids, down: ids, nodeIds: ids };
}
