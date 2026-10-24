// Petit graphe d'exemple affiché dans l'aide du jeu.
export const HELP_EXAMPLE_NODES = Object.freeze([
  Object.freeze({ id: 'help-mael', name: 'Maël QUILLAT', promo: 2023 }),
  Object.freeze({ id: 'help-tom', name: 'Tom CADARIO', promo: 2024 }),
  Object.freeze({ id: 'help-louisa', name: 'Louisa REMAUD', promo: 2025 }),
  Object.freeze({ id: 'help-mamadou', name: 'Mamadou CISSE', promo: 2025 }),
  Object.freeze({ id: 'help-jules', name: 'Jules HOUSEZ', promo: 2026 }),
]);
export const HELP_EXAMPLE_EDGES = Object.freeze([
  Object.freeze({ source: 'help-mael', target: 'help-tom' }),
  Object.freeze({ source: 'help-tom', target: 'help-louisa' }),
  Object.freeze({ source: 'help-tom', target: 'help-mamadou' }),
  Object.freeze({ source: 'help-louisa', target: 'help-jules' }),
]);
export const HELP_EXAMPLE_GRAPH = (() => {
  const byId = new Map(HELP_EXAMPLE_NODES.map((node) => [node.id, node]));
  const adjacency = new Map(HELP_EXAMPLE_NODES.map(({ id }) => [id, new Set()]));
  HELP_EXAMPLE_EDGES.forEach(({ source, target }) => {
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  });
  return { byId, adjacency, edges: HELP_EXAMPLE_EDGES };
})();
export const HELP_EXAMPLE_START_ID = 'help-mael';
export const HELP_EXAMPLE_END_ID = 'help-jules';
export const HELP_EXAMPLE_SHORTEST_IDS = new Set(['help-mael', 'help-tom', 'help-louisa', 'help-jules']);
export const HELP_EXAMPLE_SHORTEST_EDGE_KEYS = new Set([
  ['help-mael', 'help-tom'].sort().join('|'),
  ['help-tom', 'help-louisa'].sort().join('|'),
  ['help-louisa', 'help-jules'].sort().join('|'),
]);
export const HELP_EXAMPLE_POSSIBLE_IDS = HELP_EXAMPLE_SHORTEST_IDS;
export const HELP_EXAMPLE_ORDERED_IDS = Object.freeze(['help-mael', 'help-tom', 'help-louisa', 'help-mamadou', 'help-jules']);
