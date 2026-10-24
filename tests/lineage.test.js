import { describe, expect, it } from 'vitest';
import { buildIndex, getLineage, isLinkInLineage } from '../src/lib/lineage';

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
