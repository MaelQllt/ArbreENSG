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

const PROMO_ROW_GAP = 95;
const ISLAND_NODE_GAP = 18;
const ISLAND_GAP = 30;
const ORDER_SWEEPS = 8;
const linkId = (endpoint) => (typeof endpoint === 'object' ? endpoint.id : endpoint);

/**
 * Repère de petits groupes familiaux, puis ordonne les personnes par année
 * pour réduire les croisements entre leurs liens.
 */
function layoutGraph(nodes, links, promos) {
  const nodeById = new Map(nodes.map((node, index) => [node.id, { ...node, index }]));
  const neighbors = new Map(nodes.map((node) => [node.id, new Map()]));
  links.forEach((link) => {
    const source = linkId(link.source);
    const target = linkId(link.target);
    if (source === target || !neighbors.has(source) || !neighbors.has(target)) return;
    neighbors.get(source).set(target, (neighbors.get(source).get(target) ?? 0) + 1);
    neighbors.get(target).set(source, (neighbors.get(target).get(source) ?? 0) + 1);
  });

  // Détection de communautés par modularité (mouvements locaux de Louvain).
  // Les personnes sans lien restent regroupées ensemble au lieu de former
  // chacune un îlot qui étirerait inutilement le graphe.
  const ids = nodes.map((node) => node.id);
  const degrees = new Map(ids.map((id) => [
    id,
    [...neighbors.get(id).values()].reduce((sum, weight) => sum + weight, 0),
  ]));
  const totalDegree = [...degrees.values()].reduce((sum, degree) => sum + degree, 0);
  const community = new Map(ids.map((id, i) => [id, i]));
  const communityStrength = new Map(ids.map((id, i) => [i, degrees.get(id)]));

  if (totalDegree > 0) {
    for (let pass = 0; pass < 24; pass += 1) {
      let moved = 0;
      ids.forEach((id) => {
        const oldCommunity = community.get(id);
        const degree = degrees.get(id);
        communityStrength.set(oldCommunity, communityStrength.get(oldCommunity) - degree);

        const linksByCommunity = new Map();
        neighbors.get(id).forEach((weight, neighborId) => {
          const neighborCommunity = community.get(neighborId);
          linksByCommunity.set(
            neighborCommunity,
            (linksByCommunity.get(neighborCommunity) ?? 0) + weight
          );
        });

        let bestCommunity = oldCommunity;
        let bestGain = (linksByCommunity.get(oldCommunity) ?? 0)
          - degree * (communityStrength.get(oldCommunity) ?? 0) / totalDegree;
        linksByCommunity.forEach((weight, candidate) => {
          const gain = weight - degree * (communityStrength.get(candidate) ?? 0) / totalDegree;
          if (gain > bestGain + 1e-9) {
            bestCommunity = candidate;
            bestGain = gain;
          }
        });

        community.set(id, bestCommunity);
        communityStrength.set(bestCommunity, (communityStrength.get(bestCommunity) ?? 0) + degree);
        if (bestCommunity !== oldCommunity) moved += 1;
      });
      if (!moved) break;
    }
  }

  const communityMembers = new Map();
  ids.forEach((id) => {
    const key = degrees.get(id) === 0 ? 'unlinked' : community.get(id);
    if (!communityMembers.has(key)) communityMembers.set(key, []);
    communityMembers.get(key).push(id);
  });
  const communities = [...communityMembers.entries()]
    .sort((a, b) => Math.min(...a[1].map((id) => nodeById.get(id).index))
      - Math.min(...b[1].map((id) => nodeById.get(id).index)));
  // Ordre barycentrique dans chaque îlot : les parrains et fillots proches
  // dans le graphe restent voisins sur leur rangée de promo.
  const orders = new Map(promos.map((promo) => [promo, new Map()]));
  promos.forEach((promo) => {
    communities.forEach(([, members], communityIndex) => {
      const cohort = members
        .filter((id) => nodeById.get(id).promo === promo)
        .sort((a, b) => nodeById.get(a).index - nodeById.get(b).index);
      if (cohort.length) orders.get(promo).set(communityIndex, cohort);
    });
  });

  const refreshRanks = () => {
    const ranks = new Map();
    let rank = 0;
    promos.forEach((promo) => {
      communities.forEach((_, communityIndex) => {
        (orders.get(promo).get(communityIndex) ?? []).forEach((id) => {
          ranks.set(id, rank);
          rank += 1;
        });
      });
    });
    return ranks;
  };

  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep += 1) {
    [promos, [...promos].reverse()].forEach((direction) => {
      direction.forEach((promo) => {
        const ranks = refreshRanks();
        communities.forEach((_, communityIndex) => {
          const cohort = orders.get(promo).get(communityIndex);
          if (!cohort || cohort.length < 2) return;
          cohort.sort((a, b) => {
            const barycenter = (id) => {
              let sum = 0;
              let count = 0;
              neighbors.get(id).forEach((weight, neighborId) => {
                if (nodeById.get(neighborId).promo === promo || !ranks.has(neighborId)) return;
                sum += ranks.get(neighborId) * weight;
                count += weight;
              });
              return count ? sum / count : ranks.get(id);
            };
            const difference = barycenter(a) - barycenter(b);
            return Math.abs(difference) > 1e-6 ? difference : ranks.get(a) - ranks.get(b);
          });
        });
      });
    });
  }

  const maxCohortSize = communities.map(([, members]) =>
    Math.max(1, ...promos.map((promo) => members.filter((id) => nodeById.get(id).promo === promo).length))
  );
  const graphWidth = maxCohortSize.reduce((sum, count) => sum + count * ISLAND_NODE_GAP, 0)
    + Math.max(0, communities.length - 1) * ISLAND_GAP;
  let cursor = -graphWidth / 2;
  const layoutX = new Map();
  communities.forEach(([, members], communityIndex) => {
    const slotWidth = maxCohortSize[communityIndex] * ISLAND_NODE_GAP;
    const centerX = cursor + slotWidth / 2;
    promos.forEach((promo) => {
      const cohort = orders.get(promo).get(communityIndex) ?? [];
      cohort.forEach((id, i) => {
        layoutX.set(id, centerX + (i - (cohort.length - 1) / 2) * ISLAND_NODE_GAP);
      });
    });
    cursor += slotWidth + ISLAND_GAP;
  });
  return layoutX;
}

/** Prépare une copie des données pour react-force-graph (qui mute ses objets). */
export function prepareGraph(raw) {
  const promos = [...new Set(raw.nodes.map((n) => n.promo))].sort((a, b) => a - b);
  const promoIndices = new Map(promos.map((promo, index) => [promo, index]));
  const index = buildIndex(raw);
  const layoutX = layoutGraph(raw.nodes, raw.links, promos);
  return {
    promos,
    index,
    graphData: {
      nodes: raw.nodes.map((n) => {
        const promoIndex = promoIndices.get(n.promo);
        const promoY = (promoIndex - (promos.length - 1) / 2) * PROMO_ROW_GAP;
        return {
          ...n,
          promoIndex,
          promoY,
          layoutX: layoutX.get(n.id) ?? 0,
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
