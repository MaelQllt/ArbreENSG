import { describe, expect, it } from 'vitest';
import { mergeStudentData, parseStudentsCsv, serializeStudentsCsv } from '../src/lib/csv';

const csv = [
  '﻿Étudiant·e;Promo;Code;Filière;Parrains',
  'Jean Dupont;2022;ING;;',
  'Marie Curie;2023;ING;Carthagéo;Dupont Jean',
  '"Ada ""Lovelace"" King";2024;LG;;Marie Curie, Inconnu Total',
  'Marie Curie;2023;ING;;',
  'Sans Promo;;ING;;',
].join('\r\n');

describe('parseStudentsCsv', () => {
  const { data, warnings } = parseStudentsCsv(csv);

  it('lit les étudiants, le séparateur et les guillemets', () => {
    expect(data.nodes.map((node) => node.name))
      .toEqual(['Jean Dupont', 'Marie Curie', 'Ada "Lovelace" King']);
    expect(data.nodes[1]).toMatchObject({ promo: 2023, code: 'ING', filiere: 'Carthagéo' });
  });

  it('relie les parrains même écrits dans le désordre', () => {
    expect(data.links).toEqual([
      { source: 's-0', target: 's-1' },
      { source: 's-1', target: 's-2' },
    ]);
  });

  it('signale doublons, promos illisibles et parrains introuvables', () => {
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toMatch(/doublon/);
    expect(warnings.join('\n')).toMatch(/promo illisible/);
    expect(warnings.join('\n')).toMatch(/Inconnu Total/);
  });

  it('refuse un fichier sans colonne promo', () => {
    expect(() => parseStudentsCsv('nom complet\nJean Dupont\n')).toThrow(/promo/);
  });

  it('retrouve les mêmes données après export puis réimport', () => {
    const again = parseStudentsCsv(serializeStudentsCsv(data)).data;
    expect(again.nodes.map(({ name, promo, code }) => ({ name, promo, code })))
      .toEqual(data.nodes.map(({ name, promo, code }) => ({ name, promo, code })));
    expect(again.links).toEqual(data.links);
  });
});

describe('mergeStudentData', () => {
  it('garde les ajouts admin et reprend les corrections du CSV de référence', () => {
    const primary = {
      nodes: [{ id: 'a', name: 'Jean Dupont', promo: 2022 }, { id: 'b', name: 'Ajout Admin', promo: 2024 }],
      links: [{ source: 'a', target: 'b' }],
    };
    const reference = {
      nodes: [{ id: 'x', name: 'dupont jean', promo: 2022, code: 'ING' }, { id: 'y', name: 'Nouveau Venu', promo: 2025 }],
      links: [{ source: 'x', target: 'y' }],
    };
    const merged = mergeStudentData(primary, reference);
    expect(merged.nodes.map((node) => node.name)).toEqual(['Jean Dupont', 'Ajout Admin', 'Nouveau Venu']);
    expect(merged.nodes[0].code).toBe('ING');
    expect(merged.links).toEqual([
      { source: 'a', target: 'b' },
      { source: 'a', target: 'reference-0' },
    ]);
  });
});
