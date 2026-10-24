import { describe, expect, it } from 'vitest';
import {
  findStudentNamePrefixMatch,
  normalizeStudentSearch,
  searchStudentsByName,
} from '../src/lib/studentSearch';

const students = [
  { name: 'Louis Martin' },
  { name: 'Paul Lopez' },
  { name: 'Chloé Durand' },
  { name: 'Inès Bloch' },
  { name: 'Lola Petit' },
];
const names = (list) => list.map((student) => student.name);

describe('normalizeStudentSearch', () => {
  it('ignore accents, majuscules et espaces autour', () => {
    expect(normalizeStudentSearch('  Élodie ')).toBe('elodie');
  });
});

describe('searchStudentsByName', () => {
  it('classe le début du prénom avant le début du nom, puis le milieu du nom', () => {
    expect(names(searchStudentsByName(students, 'lo')))
      .toEqual(['Lola Petit', 'Louis Martin', 'Paul Lopez', 'Chloé Durand', 'Inès Bloch']);
  });

  it('en mode prefixOnly, ne garde que les noms qui commencent par la recherche', () => {
    expect(names(searchStudentsByName(students, 'Lo', undefined, { prefixOnly: true })))
      .toEqual(['Lola Petit', 'Louis Martin', 'Paul Lopez']);
    expect(names(searchStudentsByName(students, 'i', undefined, { prefixOnly: true })))
      .toEqual(['Inès Bloch']);
  });

  it('cherche aussi dans le texte supplémentaire, après les noms', () => {
    const result = searchStudentsByName(students, 'carto', (student) => (
      student.name === 'Paul Lopez' ? 'Carthagéo cartographie' : ''
    ));
    expect(names(result)).toEqual(['Paul Lopez']);
  });

  it('renvoie tout le monde quand la recherche est vide', () => {
    expect(searchStudentsByName(students, '  ')).toHaveLength(students.length);
  });
});

describe('findStudentNamePrefixMatch', () => {
  const match = (name, query) => {
    const range = findStudentNamePrefixMatch(name, query);
    return range && name.slice(...range);
  };

  it('repère le début du prénom ou du nom de famille', () => {
    expect(match('Louis Martin', 'Lo')).toBe('Lo');
    expect(match('Paul Lopez', 'lo')).toBe('Lo');
    expect(match('Louis Martin', 'louis ma')).toBe('Louis Ma');
  });

  it('garde les accents du vrai nom', () => {
    expect(match('Élodie Dupont', 'elo')).toBe('Élo');
    expect(match('Inès Bloch', 'ine')).toBe('Inè');
  });

  it('ne repère rien au milieu d’un mot', () => {
    expect(match('Chloé Durand', 'lo')).toBeNull();
  });
});
