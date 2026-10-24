import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  findRelationPath,
  getLineage,
  isLinkInLineage,
  relationHighlight,
  relationKind,
} from '../src/lib/lineage';

// a → b → c, et d → b : b a deux parrains.
const raw = {
  nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, promo: 2020 })),
  links: [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'd', target: 'b' },
    { source: 'd', target: 'e' },
  ],
};

describe('getLineage', () => {
  const lineage = getLineage(buildIndex(raw), 'b');

  it('trouve ascendants et descendants', () => {
    expect([...lineage.ancestors].sort()).toEqual(['a', 'd']);
    expect([...lineage.descendants]).toEqual(['c']);
  });

  it('exclut les « cousins » de la lignée', () => {
    expect(lineage.nodeIds.has('e')).toBe(false);
    expect(isLinkInLineage({ source: 'd', target: 'e' }, lineage)).toBe(false);
    expect(isLinkInLineage({ source: { id: 'a' }, target: { id: 'b' } }, lineage)).toBe(true);
  });

  it('supporte une boucle sans tourner à l’infini', () => {
    const loop = { nodes: raw.nodes, links: [...raw.links, { source: 'c', target: 'a' }] };
    expect(getLineage(buildIndex(loop), 'b').nodeIds.size).toBe(4);
  });
});

describe('findRelationPath', () => {
  const index = buildIndex(raw);

  it('monte puis redescend entre deux fillots du même parrain', () => {
    // c est fillot de b, e est fillot de d, et d est parrain de b.
    expect(findRelationPath(index, 'c', 'e')).toEqual(['c', 'b', 'd', 'e']);
    expect(relationKind(index, 'c', 'b')).toBe('fillot');
    expect(relationKind(index, 'b', 'd')).toBe('fillot');
    expect(relationKind(index, 'd', 'e')).toBe('parrain');
  });

  it('ne trouve rien entre deux familles séparées', () => {
    const split = buildIndex({ nodes: [...raw.nodes, { id: 'z', name: 'z', promo: 2020 }], links: raw.links });
    expect(findRelationPath(split, 'a', 'z')).toEqual([]);
  });

  it('surligne exactement les liens du chemin', () => {
    const highlight = relationHighlight(findRelationPath(index, 'c', 'e'));
    expect(raw.links.filter((link) => isLinkInLineage(link, highlight))).toEqual([
      { source: 'b', target: 'c' },
      { source: 'd', target: 'b' },
      { source: 'd', target: 'e' },
    ]);
  });
});
