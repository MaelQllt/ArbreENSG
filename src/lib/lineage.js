/**
 * Modèle de données interne :
 * {
 *   nodes: [{ id, name, promo, code?, filiere?, bio? }],
 *   links: [{ source: <id du parrain/de la marraine>, target: <id du fillot/de la fillotte> }]
 * }
 * Un étudiant peut avoir plusieurs parrains et plusieurs fillots : graphe orienté acyclique.
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
