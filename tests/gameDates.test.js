import { describe, expect, it } from 'vitest';
import {
  dailyPeriodKey,
  formatCountdown,
  formatWeeklyReset,
  getArchiveMonthCells,
  getNextParisNoon,
  parisDateKey,
  weeklyPeriodKey,
} from '../src/game/gameDates';

// Le défi change à midi, heure de Paris. Le 25/10/2026, Paris passe de UTC+2 à UTC+1.
describe('périodes des défis', () => {
  it('le défi du jour change à midi à Paris', () => {
    expect(dailyPeriodKey(new Date('2026-10-24T09:59:00Z'))).toBe('2026-10-23'); // 11h59
    expect(dailyPeriodKey(new Date('2026-10-24T10:00:00Z'))).toBe('2026-10-24'); // 12h00
  });

  it('le jour civil suit Paris, pas UTC', () => {
    expect(parisDateKey(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25'); // 00h30
  });

  it('le défi de la semaine change le lundi à midi', () => {
    expect(weeklyPeriodKey(new Date('2026-10-26T10:59:00Z'))).toBe('2026-10-19'); // lundi 11h59
    expect(weeklyPeriodKey(new Date('2026-10-26T11:00:00Z'))).toBe('2026-10-26'); // lundi 12h00
  });

  it('calcule le prochain midi en tenant compte du changement d’heure', () => {
    expect(new Date(getNextParisNoon(new Date('2026-10-24T10:30:00Z'))).toISOString())
      .toBe('2026-10-25T11:00:00.000Z');
    expect(new Date(getNextParisNoon(new Date('2026-10-24T09:00:00Z'))).toISOString())
      .toBe('2026-10-24T10:00:00.000Z');
  });

  it('annonce le prochain défi de la semaine', () => {
    expect(formatWeeklyReset(new Date('2026-10-24T10:00:00Z'))).toBe('Prochain défi lundi 26/10 à 12h');
    expect(formatWeeklyReset(new Date('2026-10-26T12:00:00Z'))).toBe('Prochain défi lundi 02/11 à 12h');
  });
});

describe('affichage', () => {
  it('formate le compte à rebours à la minute supérieure', () => {
    expect(formatCountdown(90 * 60000 + 1)).toBe('01h31min');
    expect(formatCountdown(-5)).toBe('00h00min');
  });

  it('cale le calendrier des archives sur le lundi', () => {
    const cells = getArchiveMonthCells(new Date(Date.UTC(2026, 9, 1))); // 1er octobre 2026 : un jeudi
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });
});
