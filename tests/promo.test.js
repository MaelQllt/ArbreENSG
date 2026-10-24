import { describe, expect, it } from 'vitest';
import {
  academicYearStart,
  describePromo,
  formatStudentAffiliations,
  parseAdditionalAffiliations,
  serializeAdditionalAffiliations,
} from '../src/lib/promo';

describe('année universitaire', () => {
  it('bascule au 1er septembre', () => {
    expect(academicYearStart(new Date(2026, 7, 31))).toBe(2025);
    expect(academicYearStart(new Date(2026, 8, 1))).toBe(2026);
  });

  it('calcule le niveau et le statut de diplômé', () => {
    const date = new Date(2026, 9, 1);
    expect(describePromo(2024, date)).toMatchObject({ label: 'IT3', hasFiliere: true, graduated: false });
    expect(describePromo(2022, date)).toMatchObject({ label: 'IT5', graduated: true });
    expect(describePromo(2027, date)).toMatchObject({ label: 'Promo 2027', detail: 'à venir' });
  });
});

describe('appartenances secondaires', () => {
  it('lit les codes sur 2 ou 4 chiffres et retire les doublons', () => {
    expect(parseAdditionalAffiliations('lg23 | LG2023; M21')).toEqual([
      { code: 'LG', promo: 2023 },
      { code: 'M', promo: 2021 },
    ]);
  });

  it('fait l’aller-retour texte → objets → texte', () => {
    const text = serializeAdditionalAffiliations(parseAdditionalAffiliations('LG23 | M21'));
    expect(text).toBe('LG23 | M21');
  });

  it('formate toutes les appartenances d’un étudiant', () => {
    expect(formatStudentAffiliations({
      code: 'ing',
      promo: 2024,
      additionalAffiliations: [{ code: 'LG', promo: 2023 }],
    })).toBe('ING24/LG23');
  });
});
