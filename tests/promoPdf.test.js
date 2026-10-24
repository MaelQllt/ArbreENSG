import { describe, expect, it } from 'vitest';
import { matchPromoStudents, parsePromoPdfPages, parsePromoTitle } from '../src/lib/promoPdf';

// Reproduit la mise en page du trombinoscope : NOM centré sous la photo, prénoms
// centrés juste en dessous ; chaque libellé est un seul bloc de texte.
const label = (str, center, y, width = str.length * 4) => ({ str, x: center - width / 2, y, width });
const page = (rows, title = 'Ingénieur de l’ENSG 1ère année 2023-2024') => ({
  items: [
    { str: title, x: 180, y: 803, width: 235 },
    ...rows.flatMap((row, rowIndex) => row.flatMap(([lastName, firstName], column) => [
      label(lastName, 65 + column * 75, 637 - rowIndex * 127),
      { str: ' ', x: 80 + column * 75, y: 637 - rowIndex * 127, width: 40 },
      label(firstName, 65 + column * 75, 629 - rowIndex * 127),
    ])),
    { str: 'Page 1/1', x: 290, y: 40, width: 30 },
  ],
});

describe('parsePromoTitle', () => {
  it('lit la formation et l’année d’entrée', () => {
    expect(parsePromoTitle('Ingénieur de l’ENSG 1ère année 2023-2024')).toEqual({ code: 'ING', promo: 2023 });
    expect(parsePromoTitle('Licence professionnelle Géomètre-Géomaticien 1ère année 2025-2026'))
      .toEqual({ code: 'LG', promo: 2025 });
    expect(parsePromoTitle('Ingénieur de l’ENSG 2ème année 2024-2025')).toEqual({ code: 'ING', promo: 2023 });
    expect(parsePromoTitle('Trombinoscope')).toEqual({ code: '', promo: null });
  });
});

describe('parsePromoPdfPages', () => {
  it('associe chaque NOM à ses prénoms, espaces et tirets compris', () => {
    const result = parsePromoPdfPages([page([
      [['ASSIE', 'Kouakou Kan José Marcel'], ['DE BEER', 'Côme'], ['NGUYEN ANH TUAN', 'Thomas']],
      [['SEGUIN-CADICHE', 'Laura-Lee'], ['YE', 'Karine']],
    ])]);
    expect(result).toMatchObject({ code: 'ING', promo: 2023, warnings: [] });
    expect(result.students).toEqual([
      { lastName: 'ASSIE', firstName: 'Kouakou Kan José Marcel' },
      { lastName: 'DE BEER', firstName: 'Côme' },
      { lastName: 'NGUYEN ANH TUAN', firstName: 'Thomas' },
      { lastName: 'SEGUIN-CADICHE', firstName: 'Laura-Lee' },
      { lastName: 'YE', firstName: 'Karine' },
    ]);
  });

  it('enchaîne les pages et signale un prénom manquant', () => {
    const second = page([[['ZITO', 'Nicolas']]]);
    second.items = second.items.filter((item) => item.str !== 'Nicolas');
    const result = parsePromoPdfPages([page([[['ROY', 'Coline']]]), second]);
    expect(result.students.map((student) => student.lastName)).toEqual(['ROY', 'ZITO']);
    expect(result.warnings).toEqual(['Page 2 : prénom introuvable pour ZITO.']);
  });
});

describe('matchPromoStudents', () => {
  const base = [
    { id: '1', name: 'Côme DE BEER' },
    { id: '2', name: 'Marcel ASSIE' },
    { id: '3', name: 'Abi LAGNEAUX' },
    { id: '4', name: 'Laura-Lee SEGUIN CADICHE' },
    { id: '5', name: 'Edmond SAINT DENIS' },
    { id: '6', name: 'Paul ROY' },
  ];
  const rows = matchPromoStudents([
    { lastName: 'DE BEER', firstName: 'Côme' },
    { lastName: 'SEGUIN-CADICHE', firstName: 'Laura-Lee' },
    { lastName: 'ASSIE', firstName: 'Kouakou Kan José Marcel' },
    { lastName: 'LAGNEAUX', firstName: 'Abigaëlle' },
    { lastName: 'ROY', firstName: 'Coline' },
    { lastName: 'DENIS', firstName: 'Vincent' },
  ], base);

  it('reconnaît les étudiants déjà présents, même avec le prénom d’usage', () => {
    expect(rows.map(({ name, status, match }) => [name, status, match?.name ?? null])).toEqual([
      ['Côme DE BEER', 'existing', 'Côme DE BEER'],
      ['Laura-Lee SEGUIN-CADICHE', 'existing', 'Laura-Lee SEGUIN CADICHE'],
      ['Kouakou Kan José Marcel ASSIE', 'probable', 'Marcel ASSIE'],
      ['Abigaëlle LAGNEAUX', 'probable', 'Abi LAGNEAUX'],
      ['Coline ROY', 'homonym', 'Paul ROY'],
      ['Vincent DENIS', 'new', null],
    ]);
  });

  it('ne coche que les nouveaux et les homonymes', () => {
    expect(rows.map((row) => row.selected)).toEqual([false, false, false, false, true, true]);
  });
});
