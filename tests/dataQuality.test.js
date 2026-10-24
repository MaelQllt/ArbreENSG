import { describe, expect, it } from 'vitest';
import { findDataQualityIssues } from '../src/lib/dataQuality';

const student = (id, name, promo, extra = {}) => ({ id, name, promo, ...extra });
const keysOf = (data, type) => findDataQualityIssues(data)
  .filter((issue) => issue.type === type)
  .map((issue) => issue.key);

describe('findDataQualityIssues', () => {
  it('repère les noms presque identiques, pas les noms simplement proches', () => {
    const data = {
      nodes: [
        student('a', 'Jean DUPONT', 2022),
        student('b', 'Jean Dupond', 2022),
        student('c', 'Jeanne DURAND', 2022),
        student('d', 'Al ROY', 2023), // trop court pour juger
        student('e', 'Ali ROY', 2023),
      ],
      links: [],
    };
    expect(keysOf(data, 'duplicate')).toEqual(['doublon:jean-dupond|jean-dupont']);
  });

  it('signale un parrain plus jeune, sauf si une appartenance secondaire l’explique', () => {
    const data = {
      nodes: [
        student('p', 'Savannah DURAND', 2025),
        student('c', 'Virgile KACZOR', 2023),
        student('q', 'Tim PICHON', 2026, { additionalAffiliations: [{ code: 'LG', promo: 2023 }] }),
        student('r', 'Arthur COTTIN', 2024),
      ],
      links: [{ source: 'p', target: 'c' }, { source: 'q', target: 'r' }],
    };
    expect(keysOf(data, 'younger')).toEqual(['parrain-plus-jeune:savannah-durand>virgile-kaczor']);
  });

  it('repère une boucle une seule fois', () => {
    const data = {
      nodes: [student('a', 'Alice AAAA', 2020), student('b', 'Bruno BBBB', 2021), student('c', 'Chloé CCCC', 2022)],
      links: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }],
    };
    expect(keysOf(data, 'loop')).toEqual(['boucle:alice-aaaa|bruno-bbbb|chloe-cccc']);
  });

  it('liste les étudiants sans aucun lien', () => {
    const data = {
      nodes: [student('a', 'Alice AAAA', 2020), student('b', 'Bruno BBBB', 2021), student('z', 'Zoé SEULE', 2025)],
      links: [{ source: 'a', target: 'b' }],
    };
    expect(keysOf(data, 'isolated')).toEqual(['isole:zoe-seule']);
  });

  it('garde les mêmes clés quand les identifiants changent', () => {
    const before = { nodes: [student('s-1', 'Zoé SEULE', 2025)], links: [] };
    const after = { nodes: [student('s-9', 'Zoé SEULE', 2025)], links: [] };
    expect(keysOf(before, 'isolated')).toEqual(keysOf(after, 'isolated'));
  });
});
