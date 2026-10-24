import { describe, expect, it } from 'vitest';
import {
  buildGameGraph,
  findPath,
  findPathThrough,
  getChallenge,
  isOnPossiblePath,
} from '../supabase/functions/_shared/gameChallengeCore';

// Une ligne s0 – s1 – … – s7, plus un détour s1 – x1 – x2 – x3 – s3
// (deux étudiants de plus que s1 – s2 – s3, assez pour une contrainte hebdo).
const ids = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'x1', 'x2', 'x3'];
const students = ids.map((id) => ({ id, name: id }));
const links = [
  ...ids.slice(0, 7).map((id, index) => ({ source: id, target: ids[index + 1] })),
  { source: 's1', target: 'x1' },
  { source: 'x1', target: 'x2' },
  { source: 'x2', target: 'x3' },
  { source: 'x3', target: 's3' },
  { source: 's0', target: 's1' }, // doublon ignoré
  { source: 's5', target: 's5' }, // boucle ignorée
];
const graph = buildGameGraph(students, links);

describe('buildGameGraph', () => {
  it('ignore doublons et boucles', () => {
    expect(graph.edges).toHaveLength(11);
  });

  it('ne propose que des paires à au moins 3 liens', () => {
    expect(graph.validPairs.every((pair) => pair.distance >= 3)).toBe(true);
    expect(graph.validPairs).toContainEqual({ startId: 's0', endId: 's7', distance: 7 });
  });
});

describe('chemins', () => {
  it('trouve le plus court chemin', () => {
    expect(findPath(graph.adjacency, 's0', 's4')).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('respecte les étudiants interdits', () => {
    const allowed = new Set(ids.filter((id) => id !== 's2'));
    expect(findPath(graph.adjacency, 's0', 's4', allowed)).toEqual(['s0', 's1', 'x1', 'x2', 'x3', 's3', 's4']);
  });

  it('passe par un étudiant imposé', () => {
    expect(findPathThrough(graph.adjacency, 's0', 'x2', 's4')).toEqual(['s0', 's1', 'x1', 'x2', 'x3', 's3', 's4']);
    expect(isOnPossiblePath(graph.adjacency, 's0', 'x1', 's4')).toBe(true);
    expect(isOnPossiblePath(graph.adjacency, 's0', 's6', 's4')).toBe(false);
  });
});

describe('getChallenge', () => {
  it('donne le même défi du jour pour la même date', () => {
    const first = getChallenge(graph, 'daily', 0, 0, '2026-10-24');
    expect(getChallenge(graph, 'daily', 0, 0, '2026-10-24')).toEqual(first);
    expect(first.distance).toBeLessThanOrEqual(4);
    expect(first.solutionPath[0]).toBe(first.startId);
    expect(first.solutionPath.at(-1)).toBe(first.endId);
  });

  it('pose une contrainte cohérente sur le défi de la semaine', () => {
    const types = new Set();
    for (let week = 1; week <= 20; week += 1) {
      const { constraint, solutionPath, distance } = getChallenge(graph, 'weekly', 0, 0, `2026-W${week}`);
      expect(constraint).not.toBeNull();
      types.add(constraint.type);
      if (constraint.type === 'avoid') expect(solutionPath).not.toContain(constraint.studentId);
      else expect(solutionPath).toContain(constraint.studentId);
      expect(distance).toBe(solutionPath.length - 1);
    }
    expect([...types].sort()).toEqual(['avoid', 'through']);
  });

  it('renvoie null sans paire jouable', () => {
    expect(getChallenge(buildGameGraph(students.slice(0, 2), links), 'daily', 0, 0, 'x')).toBeNull();
  });
});
