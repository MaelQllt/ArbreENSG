import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import houseIcon from './assets/house.svg';
import BrandDivider from './components/BrandDivider';
import ShapeSwatch from './components/ShapeSwatch';
import TopoBackground, { TopoDivider } from './components/TopoBackground';
import PlayerAccountPanel, { updatePlayerAccountStatsCache } from './components/PlayerAccountPanel';
import PlayerAccountAdminPanel from './components/PlayerAccountAdminPanel';
import { hasPendingPasswordRecovery, hasSupabaseAuthCallback, recordPlayerChallengeCompletion } from './lib/playerAccounts';
import { getAccountAuthClient, getSuperadminSession, isSupabaseConfigured } from './lib/supabase';
import { describePromo, formatStudentAffiliations } from './lib/promo';
import { normalizeStudentSearch as normalizeName, searchStudentsByName } from './lib/studentSearch';
import { getGameChallengeArchive, saveGameChallengeArchive } from './lib/supabase';
import './GamePage.css';

const endpointId = (value) => (typeof value === 'object' ? value.id : value);
const EMPTY_GRAPH_HINTS = Object.freeze([]);
// Années d'entrée fixes ; describePromo recalcule automatiquement les niveaux IT chaque année.
const HELP_EXAMPLE_NODES = Object.freeze([
  Object.freeze({ id: 'help-mael', name: 'Maël QUILLAT', promo: 2023 }),
  Object.freeze({ id: 'help-tom', name: 'Tom CADARIO', promo: 2024 }),
  Object.freeze({ id: 'help-louisa', name: 'Louisa REMAUD', promo: 2025 }),
  Object.freeze({ id: 'help-mamadou', name: 'Mamadou CISSE', promo: 2025 }),
  Object.freeze({ id: 'help-jules', name: 'Jules HOUSEZ', promo: 2026 }),
]);
const HELP_EXAMPLE_EDGES = Object.freeze([
  Object.freeze({ source: 'help-mael', target: 'help-tom' }),
  Object.freeze({ source: 'help-tom', target: 'help-louisa' }),
  Object.freeze({ source: 'help-tom', target: 'help-mamadou' }),
  Object.freeze({ source: 'help-louisa', target: 'help-jules' }),
]);
const HELP_EXAMPLE_GRAPH = (() => {
  const byId = new Map(HELP_EXAMPLE_NODES.map((node) => [node.id, node]));
  const adjacency = new Map(HELP_EXAMPLE_NODES.map(({ id }) => [id, new Set()]));
  HELP_EXAMPLE_EDGES.forEach(({ source, target }) => {
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  });
  return { byId, adjacency, edges: HELP_EXAMPLE_EDGES };
})();
const HELP_EXAMPLE_START_ID = 'help-mael';
const HELP_EXAMPLE_END_ID = 'help-jules';
const HELP_EXAMPLE_SHORTEST_IDS = new Set(['help-mael', 'help-tom', 'help-louisa', 'help-jules']);
const HELP_EXAMPLE_SHORTEST_EDGE_KEYS = new Set([
  ['help-mael', 'help-tom'].sort().join('|'),
  ['help-tom', 'help-louisa'].sort().join('|'),
  ['help-louisa', 'help-jules'].sort().join('|'),
]);
const HELP_EXAMPLE_POSSIBLE_IDS = HELP_EXAMPLE_SHORTEST_IDS;
const HELP_EXAMPLE_ORDERED_IDS = Object.freeze(['help-mael', 'help-tom', 'help-louisa', 'help-mamadou', 'help-jules']);
// Keep the last resolved auth state across GamePage mounts (for example when
// switching between the graph and the game) so opening the account never
// flashes a loading/login state while Supabase restores its persisted session.
let cachedGameAccountAuth = { ready: false, user: null };
function getInitialAccountPanelState() {
  const accountState = new URLSearchParams(window.location.search).get('account');
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (accountState === 'recovery' || accountState === 'confirmed') {
    return { panel: 'account', mode: accountState };
  }
  if (hashParams.get('type') === 'recovery') return { panel: 'account', mode: 'recovery' };
  if (hashParams.get('type') === 'signup') return { panel: 'account', mode: 'confirmed' };
  if (hasPendingPasswordRecovery()) return { panel: 'account', mode: 'recovery' };
  if (hasSupabaseAuthCallback()) return { panel: 'account', mode: 'login' };
  return { panel: null, mode: 'login' };
}
const endpointNameClass = (name) => {
  const length = String(name ?? '').length;
  return length >= 26
    ? 'game-endpoint__name--very-long'
    : length >= 18
      ? 'game-endpoint__name--long'
      : '';
};

function buildDistances(adjacency, startId, allowedIds) {
  if (allowedIds && !allowedIds.has(startId)) return new Map();
  const distance = new Map([[startId, 0]]);
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of [...(adjacency.get(current) ?? [])].sort(compareIds)) {
      if (allowedIds && !allowedIds.has(next)) continue;
      if (!distance.has(next)) {
        distance.set(next, distance.get(current) + 1);
        queue.push(next);
      }
    }
  }
  return distance;
}

function findPath(adjacency, startId, endId, allowedIds) {
  if (!startId || !endId) return [];
  const previous = new Map([[startId, null]]);
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === endId) break;
    for (const next of [...(adjacency.get(current) ?? [])].sort(compareIds)) {
      if (allowedIds && !allowedIds.has(next)) continue;
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  if (!previous.has(endId)) return [];
  const path = [];
  for (let current = endId; current !== null; current = previous.get(current)) path.push(current);
  return path.reverse();
}

function findPathThrough(adjacency, startId, viaId, endId, allowedIds) {
  const canUse = (id) => !allowedIds || allowedIds.has(id);
  if (![startId, viaId, endId].every(canUse)) return [];
  if (!isOnPossiblePath(adjacency, startId, viaId, endId, allowedIds)) return [];
  const queue = [{ id: startId, path: [startId], visited: new Set([startId]) }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.id === endId) continue;
    for (const next of [...(adjacency.get(current.id) ?? [])].sort(compareIds)) {
      if (!canUse(next) || current.visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === endId && path.includes(viaId)) return path;
      const visited = new Set(current.visited);
      visited.add(next);
      queue.push({ id: next, path, visited });
    }
  }
  return [];
}

function findChallengePath(adjacency, startId, endId, allowedIds, constraint) {
  if (constraint?.type === 'through') {
    return findPathThrough(adjacency, startId, constraint.studentId, endId, allowedIds);
  }
  if (constraint?.type === 'avoid') {
    const permittedIds = new Set([...(allowedIds ?? adjacency.keys())]
      .filter((id) => id !== constraint.studentId));
    return findPath(adjacency, startId, endId, permittedIds);
  }
  return findPath(adjacency, startId, endId, allowedIds);
}

function findShortestPathsThrough(adjacency, startId, viaId, endId, allowedIds, distanceLimit) {
  const canUse = (id) => !allowedIds || allowedIds.has(id);
  if (![startId, viaId, endId].every(canUse)) {
    return { nodeIds: new Set(), edgeKeys: new Set() };
  }

  const toVia = buildDistances(adjacency, viaId, allowedIds);
  const toEnd = buildDistances(adjacency, endId, allowedIds);
  const viaToEnd = toEnd.get(viaId) ?? Infinity;
  const queue = [{
    id: startId,
    path: [startId],
    visited: new Set([startId]),
    seenVia: startId === viaId,
  }];
  const nodeIds = new Set();
  const edgeKeys = new Set();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const usedEdges = current.path.length - 1;
    if (current.id === endId) {
      if (current.seenVia && usedEdges === distanceLimit) {
        current.path.forEach((id) => nodeIds.add(id));
        current.path.slice(1).forEach((id, index) => {
          edgeKeys.add([current.path[index], id].sort(compareIds).join('|'));
        });
      }
      continue;
    }
    if (usedEdges >= distanceLimit) continue;

    const remaining = current.seenVia
      ? toEnd.get(current.id) ?? Infinity
      : (toVia.get(current.id) ?? Infinity) + viaToEnd;
    if (usedEdges + remaining > distanceLimit) continue;

    for (const next of [...(adjacency.get(current.id) ?? [])].sort(compareIds)) {
      if (!canUse(next) || current.visited.has(next)) continue;
      const seenVia = current.seenVia || next === viaId;
      if (next === endId && !seenVia) continue;

      const nextEdges = usedEdges + 1;
      const nextRemaining = seenVia
        ? toEnd.get(next) ?? Infinity
        : (toVia.get(next) ?? Infinity) + viaToEnd;
      if (nextEdges + nextRemaining > distanceLimit) continue;

      const visited = new Set(current.visited);
      visited.add(next);
      queue.push({ id: next, path: [...current.path, next], visited, seenVia });
    }
  }

  return { nodeIds, edgeKeys };
}

// Un étudiant appartient à un chemin simple entre les deux bornes si deux
// routes intérieurement disjointes le relient à chacune des bornes.
function isOnPossiblePath(adjacency, startId, candidateId, endId, allowedIds) {
  if (candidateId === startId || candidateId === endId) return true;
  const ids = [...(allowedIds ?? adjacency.keys())];
  const indexes = new Map(ids.map((id, index) => [id, index]));
  const startIndex = indexes.get(startId);
  const endIndex = indexes.get(endId);
  const candidateIndex = indexes.get(candidateId);
  if ([startIndex, endIndex, candidateIndex].some((index) => index === undefined)) return false;

  const sink = ids.length * 2;
  const network = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from, to, capacity) => {
    const forward = { to, reverse: network[to].length, capacity };
    const backward = { to: from, reverse: network[from].length, capacity: 0 };
    network[from].push(forward);
    network[to].push(backward);
  };

  ids.forEach((id, index) => addEdge(index * 2, index * 2 + 1, id === candidateId ? 2 : 1));
  ids.forEach((id, index) => {
    for (const next of adjacency.get(id) ?? []) {
      const nextIndex = indexes.get(next);
      if (nextIndex === undefined || index >= nextIndex) continue;
      addEdge(index * 2 + 1, nextIndex * 2, 2);
      addEdge(nextIndex * 2 + 1, index * 2, 2);
    }
  });
  addEdge(startIndex * 2 + 1, sink, 1);
  addEdge(endIndex * 2 + 1, sink, 1);

  const source = candidateIndex * 2 + 1;
  let flow = 0;
  while (flow < 2) {
    const parent = Array(network.length).fill(null);
    parent[source] = { from: -1, edgeIndex: -1 };
    const queue = [source];
    for (let cursor = 0; cursor < queue.length && parent[sink] === null; cursor += 1) {
      const current = queue[cursor];
      network[current].forEach((edge, edgeIndex) => {
        if (edge.capacity > 0 && parent[edge.to] === null) {
          parent[edge.to] = { from: current, edgeIndex };
          queue.push(edge.to);
        }
      });
    }
    if (parent[sink] === null) break;

    for (let current = sink; current !== source;) {
      const { from, edgeIndex } = parent[current];
      const edge = network[from][edgeIndex];
      edge.capacity -= 1;
      network[current][edge.reverse].capacity += 1;
      current = from;
    }
    flow += 1;
  }
  return flow === 2;
}

function buildGameGraph(students, links) {
  const byId = new Map(students.map((student) => [student.id, student]));
  const adjacency = new Map(students.map((student) => [student.id, new Set()]));
  const seenEdges = new Set();
  const edges = [];

  links.forEach((link) => {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (!byId.has(source) || !byId.has(target) || source === target) return;
    const edgeKey = [source, target].sort().join('|');
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      edges.push({ source, target });
    }
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  });

  const validPairs = [];
  students.forEach((student, index) => {
    const distances = buildDistances(adjacency, student.id);
    students.slice(index + 1).forEach((other) => {
      const distance = distances.get(other.id);
      // ENSGdle requires at least two students between the endpoints.
      if (!distance || distance < 3) return;
      const [start, end] = [student, other].sort((a, b) => compareIds(a.id, b.id));
      validPairs.push({ startId: start.id, endId: end.id, distance });
    });
  });

  return { adjacency, byId, edges, validPairs };
}

function hasPlayableChallenge(students, links) {
  const studentIds = new Set(students.map((student) => student.id));
  const adjacency = new Map([...studentIds].map((id) => [id, new Set()]));
  links.forEach((link) => {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (!studentIds.has(source) || !studentIds.has(target) || source === target) return;
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  });

  for (const startId of studentIds) {
    let frontier = [startId];
    const visited = new Set(frontier);
    for (let distance = 0; distance < 3; distance += 1) {
      const next = [];
      frontier.forEach((id) => {
        adjacency.get(id).forEach((neighborId) => {
          if (visited.has(neighborId)) return;
          visited.add(neighborId);
          next.push(neighborId);
        });
      });
      if (distance === 2 && next.length) return true;
      frontier = next;
    }
  }
  return false;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeGraphPath(start, segments) {
  const points = [start];
  let length = 0;
  let commands = '';
  let previous = start;

  segments.forEach(({ control1, control2, end }) => {
    commands += ' C ' + control1.x + ' ' + control1.y
      + ', ' + control2.x + ' ' + control2.y
      + ', ' + end.x + ' ' + end.y;
    const controlLength = Math.hypot(control1.x - previous.x, control1.y - previous.y)
      + Math.hypot(control2.x - control1.x, control2.y - control1.y)
      + Math.hypot(end.x - control2.x, end.y - control2.y);
    length += controlLength;

    const steps = Math.min(256, Math.max(24, Math.ceil(controlLength / 8)));
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const inverse = 1 - t;
      points.push({
        x: inverse ** 3 * previous.x
          + 3 * inverse ** 2 * t * control1.x
          + 3 * inverse * t ** 2 * control2.x
          + t ** 3 * end.x,
        y: inverse ** 3 * previous.y
          + 3 * inverse ** 2 * t * control1.y
          + 3 * inverse * t ** 2 * control2.y
          + t ** 3 * end.y,
      });
    }
    previous = end;
  });

  return { commands, points, length };
}

function connectGraphPathThroughCenters(start, sourcePort, exteriorPath, targetPort, end) {
  return {
    d: 'M ' + start.x + ' ' + start.y
      + ' L ' + sourcePort.x + ' ' + sourcePort.y
      + exteriorPath.commands
      + ' L ' + end.x + ' ' + end.y,
    points: [start, ...exteriorPath.points, end],
    length: exteriorPath.length
      + Math.hypot(sourcePort.x - start.x, sourcePort.y - start.y)
      + Math.hypot(end.x - targetPort.x, end.y - targetPort.y),
  };
}

function findGraphPathBlockers(path, obstacles, excludedIds) {
  const blocked = [];
  obstacles.forEach((obstacle) => {
    if (excludedIds.has(obstacle.id)) return;
    const padding = 5;
    const intersects = path.points.some((point) => (
      point.x >= obstacle.left - padding
      && point.x <= obstacle.right + padding
      && point.y >= obstacle.top - padding
      && point.y <= obstacle.bottom + padding
    ));
    if (intersects) blocked.push(obstacle);
  });
  return blocked;
}

function parisDateParts(date) {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function parisEffectiveDate(date) {
  const { year, month, day, hour } = parisDateParts(date);
  return new Date(Date.UTC(year, month - 1, day - (hour < 12 ? 1 : 0)));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function parisDateKey(date) {
  const { year, month, day } = parisDateParts(date);
  return dateKey(new Date(Date.UTC(year, month - 1, day)));
}

function dailyPeriodKey(date) {
  return dateKey(parisEffectiveDate(date));
}

function weeklyPeriodKey(date) {
  const effectiveDate = parisEffectiveDate(date);
  const daysSinceMonday = (effectiveDate.getUTCDay() + 6) % 7;
  effectiveDate.setUTCDate(effectiveDate.getUTCDate() - daysSinceMonday);
  return dateKey(effectiveDate);
}

function formatArchiveDate(periodKey) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(periodKey + 'T12:00:00Z'));
}

function formatArchiveMonth(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function getArchiveMonthCells(month) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const leadingCells = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [
    ...Array(leadingCells).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => (
      dateKey(new Date(Date.UTC(year, monthIndex, index + 1)))
    )),
  ];
}

function getNextParisNoon(date) {
  const parts = parisDateParts(date);
  const day = parts.day + (parts.hour < 12 ? 0 : 1);
  return parisWallTimeToUtc(parts.year, parts.month, day, 12);
}

function parisWallTimeToUtc(year, month, day, hour) {
  const targetWallTime = Date.UTC(year, month - 1, day, hour);
  let guess = targetWallTime;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const local = parisDateParts(new Date(guess));
    const representedWallTime = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    guess += targetWallTime - representedWallTime;
  }
  return guess;
}

function getNextParisMondayNoon(date) {
  const { year, month, day, hour } = parisDateParts(date);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday = (8 - calendarDate.getUTCDay()) % 7;
  const daysToAdd = daysUntilMonday === 0 && hour >= 12 ? 7 : daysUntilMonday;
  calendarDate.setUTCDate(calendarDate.getUTCDate() + daysToAdd);
  return parisWallTimeToUtc(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth() + 1,
    calendarDate.getUTCDate(),
    12
  );
}

function formatCountdown(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours).padStart(2, '0') + 'h' + String(minutes).padStart(2, '0') + 'min';
}

function formatWeeklyReset(date) {
  const nextReset = new Date(getNextParisMondayNoon(date));
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(nextReset);
  const values = Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
  return 'Prochain défi ' + values.weekday + ' ' + values.day + '/' + values.month + ' à 12h';
}

function compareIds(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function orientChallenge(pair, seed, constraint, solutionPath) {
  const reverse = hashString(seed + ':direction') % 2 === 1;
  const startId = reverse ? pair.endId : pair.startId;
  const endId = reverse ? pair.startId : pair.endId;
  const orientedPath = reverse ? [...solutionPath].reverse() : solutionPath;
  return {
    ...pair,
    startId,
    endId,
    constraint,
    solutionPath: orientedPath,
    distance: Math.max(0, orientedPath.length - 1),
  };
}

function getChallenge(gameGraph, mode, practiceSeed, round, periodKey, weeklyVariant = 0) {
  if (!gameGraph.validPairs.length) return null;
  const sorted = [...gameGraph.validPairs].sort((a, b) => (
    compareIds(a.startId, b.startId) || compareIds(a.endId, b.endId)
  ));
  const seed = mode === 'practice'
    ? 'practice:' + practiceSeed + ':' + round
    : mode + ':' + periodKey
      + (mode === 'weekly' && weeklyVariant > 0 ? ':preview:' + weeklyVariant : '');
  const hash = hashString(seed);

  if (mode === 'daily') {
    const accessible = sorted.filter((pair) => pair.distance <= 4);
    const candidates = accessible.length ? accessible : sorted;
    const pair = candidates[hash % candidates.length];
    return orientChallenge(
      pair,
      seed,
      null,
      findPath(gameGraph.adjacency, pair.startId, pair.endId)
    );
  }

  if (mode === 'weekly') {
    // A weekly rule should force a visibly longer route, not merely a different
    // equally short (or one-link-longer) path.
    const minimumDetour = 2;
    const harder = sorted.filter((pair) => pair.distance >= 4 && pair.distance <= 7);
    const candidates = harder.length ? harder : sorted.filter((pair) => pair.distance >= 3);
    const startIndex = candidates.length ? hash % candidates.length : 0;
    const orderedPairs = candidates.length
      ? [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)]
      : [];
    const preferredType = hashString(seed + ':rule') % 2 === 0 ? 'avoid' : 'through';
    const findScenario = (type) => {
      for (const pair of orderedPairs.slice(0, 256)) {
        const shortest = findPath(gameGraph.adjacency, pair.startId, pair.endId);
        const interior = shortest.slice(1, -1);
        if (type === 'through') {
          for (const blockedId of interior) {
            const permittedIds = new Set([...gameGraph.adjacency.keys()].filter((id) => id !== blockedId));
            const detour = findPath(gameGraph.adjacency, pair.startId, pair.endId, permittedIds);
            if (!detour.length
              || detour.length < shortest.length + minimumDetour
              || detour.length > 10) continue;
            const extraStudents = detour.slice(1, -1).filter((id) => !shortest.includes(id));
            for (const studentId of extraStudents) {
              const routeThroughStudent = findPathThrough(
                gameGraph.adjacency,
                pair.startId,
                studentId,
                pair.endId
              );
              if (routeThroughStudent.length >= shortest.length + minimumDetour
                && routeThroughStudent.length <= 10) {
                return {
                  pair,
                  constraint: { type: 'through', studentId },
                  solutionPath: routeThroughStudent,
                };
              }
            }
          }
          // Never fall back to requiring a node already on an optimal path:
          // that rule would be satisfied without changing the route.
          continue;
        }
        for (const studentId of interior) {
          const permittedIds = new Set([...gameGraph.adjacency.keys()].filter((id) => id !== studentId));
          const detour = findPath(gameGraph.adjacency, pair.startId, pair.endId, permittedIds);
          if (detour.length < shortest.length + minimumDetour || detour.length > 10) continue;
          return {
            pair,
            constraint: { type: 'avoid', studentId },
            solutionPath: detour,
          };
        }
      }
      return null;
    };

    const scenario = findScenario(preferredType) ?? findScenario(preferredType === 'avoid' ? 'through' : 'avoid');
    if (scenario) return orientChallenge(scenario.pair, seed, scenario.constraint, scenario.solutionPath);
    const pair = orderedPairs[0] ?? sorted[hash % sorted.length];
    return orientChallenge(
      pair,
      seed,
      null,
      findPath(gameGraph.adjacency, pair.startId, pair.endId)
    );
  }

  const pair = sorted[hash % sorted.length];
  return orientChallenge(
    pair,
    seed,
    null,
    findPath(gameGraph.adjacency, pair.startId, pair.endId)
  );
}

function challengeArchiveKey(mode, periodKey, promoYears) {
  return mode + ':' + periodKey + ':' + [...promoYears].map(Number).sort((a, b) => a - b).join(',');
}

async function getOrFreezeChallengeArchive(mode, periodKey, promoYears, challenge, graph) {
  const scope = [...promoYears].map(Number).sort((a, b) => a - b).join(',');
  const existing = await getGameChallengeArchive(mode, periodKey, scope);
  if (existing) return existing;
  if (!challenge) return null;
  return saveGameChallengeArchive(mode, periodKey, promoYears, challenge, graph);
}

function getStudentInitials(name) {
  const [firstName, ...surnameParts] = name.trim().split(/\s+/);
  return [firstName, surnameParts.join(' ')]
    .filter(Boolean)
    .map((part) => Array.from(part)[0].toLocaleUpperCase('fr') + '…')
    .join(' ');
}

function GameGraph({ graph, nodes, hintNodes = EMPTY_GRAPH_HINTS, startId, endId, requiredId, forbiddenId = null, weeklyMode = false, practiceMode = false, shortestIds, shortestEdgeKeys, possibleIds, orderedIds, solutionLayout = false, ariaLabel = 'Graphe des personnes trouvées' }) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const planeRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [layout, setLayout] = useState({
    width: 0,
    height: 0,
    scale: 1,
    planeWidth: 0,
    nodeWidth: 238,
    horizontalScroll: false,
    lines: [],
  });
  const scaleRef = useRef(1);
  scaleRef.current = layout.scale;

  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const renderedNodes = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    hintNodes.forEach((node) => {
      if (!byId.has(node.id)) byId.set(node.id, node);
    });
    return [...byId.values()];
  }, [nodes, hintNodes]);
  const renderedIds = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
  const ghostIds = useMemo(() => new Set(hintNodes
    .filter((node) => !visibleIds.has(node.id))
    .map((node) => node.id)), [hintNodes, visibleIds]);
  const stepNumbers = useMemo(
    () => (solutionLayout && orderedIds) ? new Map(orderedIds.map((id, index) => [id, index + 1])) : null,
    [orderedIds, solutionLayout]
  );
  const groups = useMemo(() => {
    const orderIndex = orderedIds ? new Map(orderedIds.map((id, index) => [id, index])) : null;
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const byPromo = new Map();
    renderedNodes.forEach((node) => {
      if (!byPromo.has(node.promo)) byPromo.set(node.promo, []);
      byPromo.get(node.promo).push(node);
    });
    const presentPromos = [...byPromo.keys()].sort((a, b) => a - b);
    const firstPromo = presentPromos[0];
    const lastPromo = presentPromos[presentPromos.length - 1];
    const promos = presentPromos.length
      ? Array.from({ length: lastPromo - firstPromo + 1 }, (_, index) => firstPromo + index)
      : [];
    const ordered = new Map(presentPromos.map((promo) => [
      promo,
      byPromo.get(promo).sort((a, b) => orderIndex
        ? orderIndex.get(a.id) - orderIndex.get(b.id)
        : a.name.localeCompare(b.name, 'fr')),
    ]));

    // Aligne chaque promo sur ses liens avec les promos voisines pour réduire
    // les croisements qui apparaissent avec un tri alphabétique seul.
    for (let pass = 0; pass < 3; pass += 1) {
      const directions = [presentPromos, [...presentPromos].reverse()];
      directions.forEach((sweep) => {
        sweep.forEach((promo) => {
          const current = ordered.get(promo);
          const currentIndex = new Map(current.map((node, index) => [node.id, index]));
          const score = (node) => {
            const neighbors = [...(graph.adjacency.get(node.id) ?? [])]
              .map((id) => {
                const neighbor = graph.byId.get(id);
                const neighborLayer = neighbor && ordered.get(neighbor.promo);
                if (!neighborLayer || neighbor.promo === promo) return null;
                const index = neighborLayer.findIndex((entry) => entry.id === id);
                return index < 0 ? null : { index, weight: 1 / Math.abs(neighbor.promo - promo) };
              })
              .filter(Boolean);
            if (!neighbors.length) return { center: currentIndex.get(node.id), degree: 0 };
            const weight = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
            return {
              center: neighbors.reduce((sum, neighbor) => sum + neighbor.index * neighbor.weight, 0) / weight,
              degree: neighbors.length,
            };
          };
          const scores = new Map(current.map((node) => [node.id, score(node)]));
          ordered.set(promo, [...current].sort((a, b) => {
            const aScore = scores.get(a.id);
            const bScore = scores.get(b.id);
            if (aScore.degree && bScore.degree && Math.abs(aScore.center - bScore.center) > 0.001) {
              return aScore.center - bScore.center;
            }
            if (aScore.degree !== bScore.degree) return bScore.degree - aScore.degree;
            return currentIndex.get(a.id) - currentIndex.get(b.id);
          }));
        });
      });
    }

    // Improve row order by counting crossings and then favoring shorter links.
    // Links are undirected, regardless of their stored direction.
    const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
    const maxRowWidth = Math.max(1, ...[...ordered.values()].map((members) => members.length));
    const countCrossings = () => {
      const positions = new Map([...ordered].map(([promo, members]) => [
        promo,
        new Map(members.map((node, index) => [node.id, {
          index,
          position: members.length > 1 ? index / (members.length - 1) : 0.5,
        }])),
      ]));
      const levelSegments = new Map();
      const sameLevelSegments = new Map();
      const spanningEdges = [];
      let rowSpan = 0;
      visibleEdges.forEach((edge) => {
        const source = graph.byId.get(edge.source);
        const target = graph.byId.get(edge.target);
        if (!source || !target) return;
        const sourcePosition = positions.get(source.promo)?.get(edge.source);
        const targetPosition = positions.get(target.promo)?.get(edge.target);
        if (!sourcePosition || !targetPosition) return;
        if (source.promo === target.promo) {
          rowSpan += Math.abs(sourcePosition.index - targetPosition.index);
          if (!sameLevelSegments.has(source.promo)) sameLevelSegments.set(source.promo, []);
          sameLevelSegments.get(source.promo).push({
            from: Math.min(sourcePosition.position, targetPosition.position),
            to: Math.max(sourcePosition.position, targetPosition.position),
          });
          return;
        }
        rowSpan += Math.abs(sourcePosition.position - targetPosition.position) * maxRowWidth;
        const [topPromo, bottomPromo] = [source.promo, target.promo].sort((a, b) => a - b);
        const topIndex = source.promo === topPromo ? sourcePosition.position : targetPosition.position;
        const bottomIndex = source.promo === bottomPromo ? sourcePosition.position : targetPosition.position;
        spanningEdges.push({ topPromo, bottomPromo, topIndex, bottomIndex });
        if (topIndex === undefined || bottomIndex === undefined) return;
        const promoSpan = bottomPromo - topPromo;
        for (let promo = topPromo; promo < bottomPromo; promo += 1) {
          const fromRatio = (promo - topPromo) / promoSpan;
          const toRatio = (promo + 1 - topPromo) / promoSpan;
          const pairKey = promo + '|' + (promo + 1);
          if (!levelSegments.has(pairKey)) levelSegments.set(pairKey, []);
          levelSegments.get(pairKey).push({
            from: topIndex + (bottomIndex - topIndex) * fromRatio,
            to: topIndex + (bottomIndex - topIndex) * toRatio,
          });
        }
      });

      let crossings = 0;
      levelSegments.forEach((edgesInPair) => {
        for (let first = 0; first < edgesInPair.length; first += 1) {
          for (let second = first + 1; second < edgesInPair.length; second += 1) {
            const a = edgesInPair[first];
            const b = edgesInPair[second];
            if ((a.from - b.from) * (a.to - b.to) < 0) {
              crossings += 1;
            }
          }
        }
      });
      sameLevelSegments.forEach((segments, promo) => {
        const row = positions.get(promo);
        spanningEdges.forEach(({ topPromo, bottomPromo, topIndex, bottomIndex }) => {
          if (promo <= topPromo || promo >= bottomPromo) return;
          const ratio = (promo - topPromo) / (bottomPromo - topPromo);
          const x = topIndex + (bottomIndex - topIndex) * ratio;
          const hiddenByNode = [...(row?.values() ?? [])].some((node) => Math.abs(node.position - x) < 0.12);
          if (hiddenByNode) return;
          if (segments.some((segment) => x > segment.from && x < segment.to)) crossings += 1;
        });
      });
      return crossings * (visibleEdges.length * maxRowWidth + 1) + rowSpan;
    };

    const swapsByPromo = presentPromos.map((promo) => {
      const members = ordered.get(promo);
      const swaps = [];
      for (let first = 0; first < members.length - 1; first += 1) {
        for (let second = first + 1; second < members.length; second += 1) {
          swaps.push([first, second]);
        }
      }
      return { promo, swaps };
    });
    for (let pass = 0; pass < 6; pass += 1) {
      const currentCrossings = countCrossings();
      let bestScore = currentCrossings;
      let bestMove = null;

      // Test every pair in a row, not just neighbors: an edge pattern can
      // require moving a student across several positions to remove a crossing.
      const rankedSwapsByPromo = swapsByPromo.map(({ promo, swaps }) => {
        const members = ordered.get(promo);
        const candidates = [];
        swaps.forEach(([first, second]) => {
          [members[first], members[second]] = [members[second], members[first]];
          const score = countCrossings();
          candidates.push({ promo, first, second, score });
          if (score < bestScore) {
            bestScore = score;
            bestMove = [{ promo, first, second }];
          }
          [members[first], members[second]] = [members[second], members[first]];
        });
        candidates.sort((a, b) => a.score - b.score);
        return { promo, swaps: candidates.slice(0, 16) };
      });

      // Sometimes two rows must change together. Check paired swaps as well
      // so a useful move is not rejected just because its first half is neutral.
      for (let firstRow = 0; firstRow < rankedSwapsByPromo.length - 1; firstRow += 1) {
        const firstEntry = rankedSwapsByPromo[firstRow];
        if (!firstEntry.swaps.length) continue;
        const firstMembers = ordered.get(firstEntry.promo);
        for (let secondRow = firstRow + 1; secondRow < rankedSwapsByPromo.length; secondRow += 1) {
          const secondEntry = rankedSwapsByPromo[secondRow];
          if (!secondEntry.swaps.length) continue;
          const secondMembers = ordered.get(secondEntry.promo);
          firstEntry.swaps.forEach((firstSwap) => {
            const { first: firstA, second: firstB } = firstSwap;
            [firstMembers[firstA], firstMembers[firstB]] = [firstMembers[firstB], firstMembers[firstA]];
            secondEntry.swaps.forEach((secondSwap) => {
              const { first: secondA, second: secondB } = secondSwap;
              [secondMembers[secondA], secondMembers[secondB]] = [secondMembers[secondB], secondMembers[secondA]];
              const score = countCrossings();
              if (score < bestScore) {
                bestScore = score;
                bestMove = [
                  { promo: firstEntry.promo, first: firstA, second: firstB },
                  { promo: secondEntry.promo, first: secondA, second: secondB },
                ];
              }
              [secondMembers[secondA], secondMembers[secondB]] = [secondMembers[secondB], secondMembers[secondA]];
            });
            [firstMembers[firstA], firstMembers[firstB]] = [firstMembers[firstB], firstMembers[firstA]];
          });
        }
      }

      if (!bestMove) break;
      bestMove.forEach(({ promo, first, second }) => {
        const members = ordered.get(promo);
        [members[first], members[second]] = [members[second], members[first]];
      });
    }
    return promos.map((promo) => [promo, ordered.get(promo) ?? []]);
  }, [nodes, renderedNodes, graph.edges, graph.adjacency, graph.byId, orderedIds]);

  const widestPromoRow = Math.max(1, ...groups.map(([, members]) => members.length));
  const mobileSolutionLayout = solutionLayout
    && typeof window !== 'undefined'
    && window.innerWidth <= 767;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const plane = planeRef.current;
    if (!viewport || !canvas || !plane) return undefined;

    const update = () => {
      const availableWidth = Math.max(1, viewport.clientWidth);
      const availableHeight = Math.max(1, viewport.clientHeight);
      const compact = window.innerWidth <= 767;
      const compactSolution = solutionLayout && window.innerWidth <= 767;
      const mobileSolution = compactSolution && compact;
      const titleColumnWidth = mobileSolution ? 0 : compactSolution ? 84 : compact ? 0 : 128;
      const titleGap = mobileSolution ? 0 : compactSolution ? 6 : compact ? 0 : 12;
      const edgeGutter = mobileSolution ? 16 : compact ? 40 : 72;
      const columnGap = compact || compactSolution ? 8 : 14;
      const mobileNodeMinWidth = 96;
      const mobileNodeMaxWidth = 120;
      const mobileFitNodeWidth = (availableWidth - edgeGutter - Math.max(0, widestPromoRow - 1) * columnGap) / widestPromoRow;
      const horizontalScroll = mobileSolution && mobileFitNodeWidth < mobileNodeMinWidth;
      const nodeSlotWidth = mobileSolution
        ? horizontalScroll ? mobileNodeMaxWidth : Math.min(mobileNodeMaxWidth, mobileFitNodeWidth)
        : compactSolution ? 150 : compact ? 112 : 238;
      plane.style.setProperty('--game-node-width', `${nodeSlotWidth}px`);
      const nodeAreaWidth = widestPromoRow * nodeSlotWidth
        + Math.max(0, widestPromoRow - 1) * columnGap
        + edgeGutter;
      const planeWidth = Math.max(availableWidth, titleColumnWidth + titleGap + nodeAreaWidth);
      const width = Math.max(1, mobileSolution ? availableWidth : plane.offsetWidth, planeWidth);
      const height = Math.max(1, plane.offsetHeight);
      const scale = mobileSolution ? 1 : Math.min(1, availableWidth / width, availableHeight / height);
      const centeredInset = Math.max(0, (availableWidth - width * scale) / 2);
      plane.style.setProperty(
        '--graph-title-align-offset',
        `${scale ? centeredInset / scale : 0}px`
      );
      const planeRect = plane.getBoundingClientRect();
      const renderedScale = scaleRef.current || 1;
      const obstacles = Array.from(nodeRefs.current.entries())
        .filter(([id]) => renderedIds.has(id))
        .map(([id, element]) => {
          const rect = element.getBoundingClientRect();
          const left = (rect.left - planeRect.left) / renderedScale;
          const top = (rect.top - planeRect.top) / renderedScale;
          const obstacleWidth = rect.width / renderedScale;
          const obstacleHeight = rect.height / renderedScale;
          return {
            id,
            left,
            top,
            right: left + obstacleWidth,
            bottom: top + obstacleHeight,
          };
        });
      const descriptors = graph.edges
        .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
        .map((edge) => {
          const sourceElement = nodeRefs.current.get(edge.source);
          const targetElement = nodeRefs.current.get(edge.target);
          if (!sourceElement || !targetElement) return null;
          const sourceRect = sourceElement.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const sourceWidth = sourceRect.width / renderedScale;
          const sourceHeight = sourceRect.height / renderedScale;
          const targetWidth = targetRect.width / renderedScale;
          const targetHeight = targetRect.height / renderedScale;
          const sourceCenterX = (sourceRect.left + sourceRect.width / 2 - planeRect.left) / renderedScale;
          const sourceCenterY = (sourceRect.top + sourceRect.height / 2 - planeRect.top) / renderedScale;
          const targetCenterX = (targetRect.left + targetRect.width / 2 - planeRect.left) / renderedScale;
          const targetCenterY = (targetRect.top + targetRect.height / 2 - planeRect.top) / renderedScale;
          const edgeKey = [edge.source, edge.target].sort().join('|');
          const sourcePromo = graph.byId.get(edge.source)?.promo;
          const targetPromo = graph.byId.get(edge.target)?.promo;
          const vertical = sourcePromo !== targetPromo
            || Math.abs(targetCenterY - sourceCenterY) > Math.abs(targetCenterX - sourceCenterX);
          return {
            edge,
            edgeKey,
            sourceWidth,
            sourceHeight,
            targetWidth,
            targetHeight,
            sourceCenterX,
            sourceCenterY,
            targetCenterX,
            targetCenterY,
            vertical,
          };
        })
        .filter(Boolean);

      const portBuckets = new Map();
      const registerPort = (nodeId, edgeKey, side, neighborPosition, extent) => {
        const bucketKey = nodeId + '\u0000' + side;
        if (!portBuckets.has(bucketKey)) portBuckets.set(bucketKey, []);
        portBuckets.get(bucketKey).push({ edgeKey, side, neighborPosition, extent });
      };
      descriptors.forEach((descriptor) => {
        const { edge, vertical, sourceCenterX, sourceCenterY, targetCenterX, targetCenterY, sourceWidth, sourceHeight, targetWidth, targetHeight } = descriptor;
        const delta = vertical ? targetCenterY - sourceCenterY : targetCenterX - sourceCenterX;
        const forward = Math.sign(delta) || 1;
        const sourceSide = vertical
          ? (forward > 0 ? 'bottom' : 'top')
          : (forward > 0 ? 'right' : 'left');
        const targetSide = vertical
          ? (forward > 0 ? 'top' : 'bottom')
          : (forward > 0 ? 'left' : 'right');
        registerPort(edge.source, descriptor.edgeKey, sourceSide, vertical ? targetCenterX : targetCenterY, vertical ? sourceWidth : sourceHeight);
        registerPort(edge.target, descriptor.edgeKey, targetSide, vertical ? sourceCenterX : sourceCenterY, vertical ? targetWidth : targetHeight);
      });

      const portOffsets = new Map();
      portBuckets.forEach((ports, bucketKey) => {
        ports.sort((a, b) => a.neighborPosition - b.neighborPosition || a.edgeKey.localeCompare(b.edgeKey));
        const narrowestPort = Math.min(...ports.map((port) => port.extent));
        const maxSpread = Math.min(72, narrowestPort * 0.72);
        const step = ports.length > 1 ? Math.min(24, maxSpread / (ports.length - 1)) : 0;
        ports.forEach((port, index) => {
          const offset = (index - (ports.length - 1) / 2) * step;
          portOffsets.set(bucketKey + '\u0000' + port.edgeKey, offset);
        });
      });

      const lines = descriptors.map((descriptor) => {
        const {
          edge, edgeKey, vertical, sourceWidth, sourceHeight, targetWidth, targetHeight,
          sourceCenterX, sourceCenterY, targetCenterX, targetCenterY,
        } = descriptor;
        const sourceForward = Math.sign(vertical ? targetCenterY - sourceCenterY : targetCenterX - sourceCenterX) || 1;
        const targetForward = -sourceForward;
        const sourceSide = vertical
          ? (sourceForward > 0 ? 'bottom' : 'top')
          : (sourceForward > 0 ? 'right' : 'left');
        const targetSide = vertical
          ? (sourceForward > 0 ? 'top' : 'bottom')
          : (sourceForward > 0 ? 'left' : 'right');
        const sourceOffset = portOffsets.get(edge.source + '\u0000' + sourceSide + '\u0000' + edgeKey) ?? 0;
        const targetOffset = portOffsets.get(edge.target + '\u0000' + targetSide + '\u0000' + edgeKey) ?? 0;
        let start;
        let end;
        let sourcePort;
        let targetPort;
        let directPath;
        if (vertical) {
          const direction = Math.sign(targetCenterY - sourceCenterY);
          start = { x: sourceCenterX, y: sourceCenterY };
          end = { x: targetCenterX, y: targetCenterY };
          sourcePort = { x: sourceCenterX + sourceOffset, y: sourceCenterY + direction * sourceHeight / 2 };
          targetPort = { x: targetCenterX + targetOffset, y: targetCenterY - direction * targetHeight / 2 };
          const lead = Math.min(48, Math.abs(targetPort.y - sourcePort.y) * 0.34);
          const exteriorPath = makeGraphPath(sourcePort, [{
            control1: { x: sourcePort.x, y: sourcePort.y + direction * lead },
            control2: { x: targetPort.x, y: targetPort.y - direction * lead },
            end: targetPort,
          }]);
          directPath = connectGraphPathThroughCenters(start, sourcePort, exteriorPath, targetPort, end);
        } else {
          start = { x: sourceCenterX, y: sourceCenterY };
          end = { x: targetCenterX, y: targetCenterY };
          sourcePort = { x: sourceCenterX + sourceForward * sourceWidth / 2, y: sourceCenterY + sourceOffset };
          targetPort = { x: targetCenterX + targetForward * targetWidth / 2, y: targetCenterY + targetOffset };
          const lead = Math.min(42, Math.abs(targetPort.x - sourcePort.x) * 0.34);
          const exteriorPath = makeGraphPath(sourcePort, [{
            control1: { x: sourcePort.x + sourceForward * lead, y: sourcePort.y },
            control2: { x: targetPort.x - sourceForward * lead, y: targetPort.y },
            end: targetPort,
          }]);
          directPath = connectGraphPathThroughCenters(start, sourcePort, exteriorPath, targetPort, end);
        }

        const excludedIds = new Set([edge.source, edge.target]);
        let chosenPath = directPath;
        const directBlockers = findGraphPathBlockers(directPath, obstacles, excludedIds);
        if (directBlockers.length > 0 && vertical) {
          const direction = Math.sign(end.y - start.y);
          const middleY = (sourcePort.y + targetPort.y) / 2;
          const railCurve = Math.min(42, Math.abs(middleY - sourcePort.y) * 0.58);
          const blockedLeft = Math.min(...directBlockers.map((obstacle) => obstacle.left));
          const blockedRight = Math.max(...directBlockers.map((obstacle) => obstacle.right));
          const outerLeft = Math.min(...obstacles.map((obstacle) => obstacle.left));
          const outerRight = Math.max(...obstacles.map((obstacle) => obstacle.right));
          const railCandidates = [...new Set([
            blockedLeft - 12,
            blockedRight + 12,
            outerLeft - 12,
            outerRight + 12,
          ])];
          const detours = railCandidates.map((routeX) => {
            const exteriorPath = makeGraphPath(sourcePort, [
              {
                control1: { x: sourcePort.x, y: sourcePort.y + direction * railCurve },
                control2: { x: routeX, y: middleY - direction * railCurve },
                end: { x: routeX, y: middleY },
              },
              {
                control1: { x: routeX, y: middleY + direction * railCurve },
                control2: { x: targetPort.x, y: targetPort.y - direction * railCurve },
                end: targetPort,
              },
            ]);
            const path = connectGraphPathThroughCenters(start, sourcePort, exteriorPath, targetPort, end);
            return { path, blockers: findGraphPathBlockers(path, obstacles, excludedIds) };
          });
          detours.sort((a, b) => a.blockers.length - b.blockers.length || a.path.length - b.path.length);
          chosenPath = detours[0]?.path ?? directPath;
        } else if (directBlockers.length > 0) {
          const laneBase = (Math.max(sourceHeight, targetHeight) / 2 + 8) / 0.75;
          const detours = [-1, 1].flatMap((side) => [0, 16, 36].map((extra) => {
            const laneY = (sourceCenterY + targetCenterY) / 2 + side * (laneBase + extra);
            const sourceDetourPort = { x: sourceCenterX, y: sourceCenterY + side * sourceHeight / 2 };
            const targetDetourPort = { x: targetCenterX, y: targetCenterY + side * targetHeight / 2 };
            const exteriorPath = makeGraphPath(sourceDetourPort, [{
              control1: { x: sourceDetourPort.x, y: laneY },
              control2: { x: targetDetourPort.x, y: laneY },
              end: targetDetourPort,
            }]);
            const path = connectGraphPathThroughCenters(start, sourceDetourPort, exteriorPath, targetDetourPort, end);
            return { path, blockers: findGraphPathBlockers(path, obstacles, excludedIds) };
          }));
          detours.sort((a, b) => a.blockers.length - b.blockers.length || a.path.length - b.path.length);
          chosenPath = detours[0]?.path ?? directPath;
        }

        return {
          key: edge.source + '>' + edge.target,
          d: chosenPath.d,
          shortest: shortestEdgeKeys.has(edgeKey),
          possible: possibleIds.has(edge.source) && possibleIds.has(edge.target),
          forbiddenConnection: Boolean(forbiddenId && (
            edge.source === forbiddenId || edge.target === forbiddenId
          )),
        };
      });
      const priority = (line) => (line.forbiddenConnection ? 3 : line.shortest ? 2 : line.possible ? 1 : 0);
      lines.sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
      setLayout((current) => {
        const closeEnough = (left, right, tolerance = 0.01) => Math.abs(left - right) < tolerance;
        const pathCoordinates = (path) => (
          path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
        ).map(Number);
        const pathsCloseEnough = (left, right) => {
          if (left === right) return true;
          const leftCoordinates = pathCoordinates(left);
          const rightCoordinates = pathCoordinates(right);
          return leftCoordinates.length === rightCoordinates.length
            && leftCoordinates.every((value, index) => Math.abs(value - rightCoordinates[index]) < 0.15);
        };
        const sameLines = current.lines.length === lines.length
          && lines.every((line, index) => {
            const previous = current.lines[index];
            return previous.key === line.key
              && previous.shortest === line.shortest
              && previous.possible === line.possible
              && previous.forbiddenConnection === line.forbiddenConnection
              && pathsCloseEnough(previous.d, line.d);
          });
        const unchanged = closeEnough(current.width, width)
          && closeEnough(current.height, height)
          && closeEnough(current.scale, scale, 0.0001)
          && closeEnough(current.planeWidth, planeWidth)
          && closeEnough(current.nodeWidth, nodeSlotWidth)
          && current.horizontalScroll === horizontalScroll
          && sameLines;
        return unchanged ? current : {
          width,
          height,
          scale,
          planeWidth,
          nodeWidth: nodeSlotWidth,
          horizontalScroll,
          lines,
        };
      });
    };

    update();
    let updateFrame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(updateFrame);
      updateFrame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(updateFrame);
    };
  }, [graph.edges, graph.byId, visibleIds, renderedIds, groups, shortestEdgeKeys, possibleIds, widestPromoRow, solutionLayout, forbiddenId, startId, endId]);

  return (
    <>
      <div
        ref={viewportRef}
        className={'game-graph__viewport'
          + (solutionLayout ? ' game-graph__viewport--solution' : '')
          + (weeklyMode ? ' game-graph__viewport--weekly' : '')
          + (practiceMode ? ' game-graph__viewport--practice' : '')
          + (layout.horizontalScroll ? ' game-graph__viewport--scrollable' : '')}
        role="region"
        aria-label={ariaLabel + (mobileSolutionLayout && layout.horizontalScroll ? ', faites défiler horizontalement pour voir tout le graphe' : '')}
      >
      <div
        ref={canvasRef}
        className="game-graph__canvas"
        style={{ height: layout.height ? layout.height * layout.scale : '100%' }}
      >
        <div
          ref={planeRef}
          className="game-graph__plane"
          style={{
            '--graph-scale': layout.scale,
            '--game-node-width': `${layout.nodeWidth}px`,
            width: layout.planeWidth ? `max(100%, ${layout.planeWidth}px)` : '100%',
          }}
        >
          <svg
            className="game-graph__links"
            width={layout.width}
            height={layout.height}
            viewBox={'0 0 ' + layout.width + ' ' + layout.height}
            aria-hidden="true"
          >
            {layout.lines.map((line) => (
              <path
                key={line.key}
                d={line.d}
                className={'game-graph__edge'
                  + (line.shortest ? ' game-graph__edge--shortest' : '')
                  + (!line.possible ? ' game-graph__edge--off-path' : '')
                  + (line.forbiddenConnection ? ' game-graph__edge--forbidden' : '')}
              />
            ))}
          </svg>
          <div className="game-graph__levels">
            {groups.map(([promo, members]) => {
              const promoInfo = describePromo(promo);
              return (
                <section className="game-graph__level" key={promo} aria-label={'Promotion ' + promo}>
                  <header className="game-graph__level-title">
                    <span>{promoInfo.label}</span>
                    <BrandDivider />
                    <span>Promo {promo}</span>
                  </header>
                  <div
                    className={'game-graph__nodes'
                      + (members.length === 0 ? ' game-graph__nodes--empty'
                        : members.length >= 5 ? ' game-graph__nodes--dense'
                          : members.length >= 3 ? ' game-graph__nodes--many'
                            : members.length === 1 ? ' game-graph__nodes--single'
                              : ' game-graph__nodes--pair')}
                    style={{ '--game-node-count': Math.max(1, members.length) }}
                  >
                    {members.map((student) => {
                      const isStart = student.id === startId;
                      const isEnd = student.id === endId;
                      const isRequired = student.id === requiredId;
                      const isForbidden = student.id === forbiddenId;
                      const isShortest = shortestIds.has(student.id);
                      const isOffPath = !possibleIds.has(student.id);
                      const isHinted = ghostIds.has(student.id);
                      const displayedName = isHinted ? getStudentInitials(student.name) : student.name;
                      const stepIndex = stepNumbers?.get(student.id) ?? 0;
                      return (
                        <div
                          key={student.id}
                          ref={(element) => {
                            if (element) nodeRefs.current.set(student.id, element);
                            else nodeRefs.current.delete(student.id);
                          }}
                          className={'game-node'
                            + (isStart ? ' game-node--start' : '')
                            + (isEnd ? ' game-node--end' : '')
                            + (isRequired ? ' game-node--required' : '')
                            + (isForbidden ? ' game-node--forbidden' : '')
                            + (isShortest ? ' game-node--shortest' : '')
                            + (isHinted ? ' game-node--hinted' : '')
                            + (isOffPath ? ' game-node--off-path' : '')
                            + (displayedName.length >= 26 ? ' game-node--very-long-name'
                              : displayedName.length >= 18 ? ' game-node--long-name' : '')}
                          aria-label={isHinted
                            ? 'Indice : ' + getStudentInitials(student.name)
                            : isForbidden ? student.name + ', interdit par la règle hebdomadaire'
                              : isRequired ? student.name + ', passage obligatoire' : undefined}
                        >
                          {stepIndex > 0 && <span className="game-node__step" aria-hidden="true">{stepIndex}</span>}
                          <ShapeSwatch promo={student.promo} size={20} />
                          <span className="game-node__copy">
                            <strong>{displayedName}</strong>
                            {isRequired && <small>Passage obligatoire</small>}
                            {isForbidden && <small>Interdit</small>}
                            {(isStart || isEnd) && <small>{isStart ? 'Départ' : 'Arrivée'}</small>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      </div>
      {mobileSolutionLayout && layout.horizontalScroll && (
        <p className="game-graph__scroll-hint">
          <svg className="game-graph__scroll-arrow" viewBox="0 0 16 10" aria-hidden="true">
            <path d="M15 5H1M3.5 2.5 1 5l2.5 2.5" />
          </svg>
          <span>Faites glisser pour voir tout le graphe</span>
          <svg className="game-graph__scroll-arrow" viewBox="0 0 16 10" aria-hidden="true">
            <g transform="translate(16 0) scale(-1 1)">
              <path d="M15 5H1M3.5 2.5 1 5l2.5 2.5" />
            </g>
          </svg>
        </p>
      )}
    </>
  );
}

export default function GamePage({ students, links }) {
  const [entryAccountState] = useState(getInitialAccountPanelState);
  const [mode, setMode] = useState('daily');
  const [round, setRound] = useState(0);
  const [attemptCount, setAttemptCount] = useState(1);
  const [challengeClock, setChallengeClock] = useState(() => new Date());
  const [practiceSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [foundIds, setFoundIds] = useState([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintedStudentIds, setHintedStudentIds] = useState([]);
  const [completionRecord, setCompletionRecord] = useState(null);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activePanel, setActivePanel] = useState(entryAccountState.panel);
  const [selectedLeaderboardPlayer, setSelectedLeaderboardPlayer] = useState(null);
  const [leaderboardPlayers, setLeaderboardPlayers] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');
  const leaderboardHasPlayersRef = useRef(false);
  const [accountInitialMode, setAccountInitialMode] = useState(entryAccountState.mode);
  const [gameSuperadminSession, setGameSuperadminSession] = useState(null);
  const [accountConnected, setAccountConnected] = useState(() => Boolean(cachedGameAccountAuth.user));
  const [accountAuthReady, setAccountAuthReady] = useState(() => cachedGameAccountAuth.ready);
  const [accountAuthUser, setAccountAuthUser] = useState(() => cachedGameAccountAuth.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPromoYears, setSelectedPromoYears] = useState(() => {
    try {
      const saved = window.localStorage.getItem('ensgdle-playable-promos-v1');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return null;
      const years = [...new Set(parsed.map(Number).filter(Number.isFinite))];
      return years.length >= 3 ? years : null;
    } catch {
      return null;
    }
  });
  const [promoDraft, setPromoDraft] = useState(null);
  const [archiveMode, setArchiveMode] = useState('daily');
  const [archiveMonth, setArchiveMonth] = useState(() => {
    const currentDate = new Date(parisDateKey(new Date()) + 'T12:00:00Z');
    return new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
  });
  const [archiveDate, setArchiveDate] = useState(null);
  const [archiveSelection, setArchiveSelection] = useState(null);
  const [frozenChallengeArchives, setFrozenChallengeArchives] = useState({});
  const menuRef = useRef(null);
  const helpButtonRef = useRef(null);
  const promoModeButtonRef = useRef(null);
  const solutionButtonRef = useRef(null);
  const panelRef = useRef(null);
  const panelCloseRef = useRef(null);
  const recordedCompletionRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    let active = true;
    let subscription;
    const hasResolvedAuthState = cachedGameAccountAuth.ready;
    let initialSessionResolved = hasResolvedAuthState;
    let hasPendingSessionEvent = false;
    let pendingSession = null;
    const syncSession = (session) => {
      const user = session?.user ?? null;
      cachedGameAccountAuth = { ready: true, user };
      setAccountAuthUser(user);
      setAccountConnected(Boolean(user));
      setAccountAuthReady(true);
    };
    getAccountAuthClient().then(async (client) => {
      if (!active) return;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (!initialSessionResolved) {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            hasPendingSessionEvent = true;
            pendingSession = session;
          }
          return;
        }
        syncSession(session);
      });
      subscription = data.subscription;
      // The singleton Supabase client emits INITIAL_SESSION to new listeners.
      // Reuse our in-memory auth state and let that event keep it current instead
      // of calling getSession again on every return to the game.
      if (hasResolvedAuthState) return;
      const { data: sessionData } = await client.auth.getSession();
      initialSessionResolved = true;
      if (active) syncSession(hasPendingSessionEvent ? pendingSession : sessionData?.session);
    }).catch(() => {
      initialSessionResolved = true;
      if (active && !hasResolvedAuthState) syncSession(null);
    });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const resolveGameSuperadmin = async () => {
      try {
        const savedAdminSession = await getSuperadminSession();
        if (savedAdminSession) {
          if (active) setGameSuperadminSession(savedAdminSession);
          return;
        }
        const client = await getAccountAuthClient();
        const { data: sessionData } = await client.auth.getSession();
        const session = sessionData?.session;
        if (!session) {
          if (active) setGameSuperadminSession(null);
          return;
        }
        const { data, error } = await client
          .from('superadmins')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (active) setGameSuperadminSession(error || !data ? null : session);
      } catch {
        if (active) setGameSuperadminSession(null);
      }
    };
    void resolveGameSuperadmin();
    return () => {
      active = false;
    };
  }, [accountAuthReady, accountAuthUser?.id]);

  useEffect(() => {
    if (activePanel !== 'leaderboard') return undefined;
    let active = true;
    if (!isSupabaseConfigured()) {
      setLeaderboardPlayers([]);
      leaderboardHasPlayersRef.current = false;
      setLeaderboardLoading(false);
      setLeaderboardError('Le classement réel nécessite la configuration de Supabase.');
      return undefined;
    }

    if (!leaderboardHasPlayersRef.current) setLeaderboardLoading(true);
    setLeaderboardError('');
    const refreshLeaderboard = async () => {
      try {
        const client = await getAccountAuthClient();
        const { data, error } = await client.rpc('get_player_leaderboard');
        if (error) throw error;
        const nextPlayers = (data ?? []).map((player) => ({
          pseudo: player.pseudo,
          firstName: player.first_name,
          lastName: player.last_name,
          promo: String(player.program_code ?? '') + String(player.arrival_year ?? '').slice(-2),
          filiere: String(player.filiere ?? '').trim().replace(/^filière non renseignée$/i, ''),
          daily: Number(player.daily_challenges ?? 0),
          weekly: Number(player.weekly_challenges ?? 0),
          score: Number(player.points ?? 0),
          isCurrentUser: player.is_current_user === true,
        })).sort((left, right) => (
          right.score - left.score || left.pseudo.localeCompare(right.pseudo, 'fr')
        ));
        if (!active) return;
        setLeaderboardPlayers(nextPlayers);
        leaderboardHasPlayersRef.current = nextPlayers.length > 0;
        setSelectedLeaderboardPlayer((current) => current
          ? nextPlayers.find((player) => player.pseudo === current.pseudo) ?? null
          : null);
        setLeaderboardError('');
      } catch (loadError) {
        if (!active) return;
        const message = String(loadError?.message ?? '');
        setLeaderboardError(
          loadError?.code === 'PGRST202' || /get_player_leaderboard|schema cache|could not find/i.test(message)
            ? 'Le classement réel n’est pas encore configuré. Exécute la dernière version de supabase/player_accounts.sql dans Supabase.'
            : 'Le classement n’a pas pu être chargé. Vérifie la connexion et réessaie.'
        );
      } finally {
        if (active) setLeaderboardLoading(false);
      }
    };

    void refreshLeaderboard();
    const refreshTimer = window.setInterval(() => void refreshLeaderboard(), 30_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [activePanel]);

  useEffect(() => {
    let timer;
    const scheduleClockRefresh = () => {
      const now = new Date();
      const nextMinute = (Math.floor(now.getTime() / 60000) + 1) * 60000;
      const nextRefresh = Math.min(nextMinute, getNextParisNoon(now));
      timer = window.setTimeout(() => {
        setChallengeClock(new Date());
        scheduleClockRefresh();
      }, Math.max(0, nextRefresh - now.getTime() + 30));
    };
    scheduleClockRefresh();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!activePanel) return undefined;
    const focusPanel = () => {
      const compactPanel = window.matchMedia('(max-width: 767px)').matches;
      if (compactPanel) panelRef.current?.focus();
      else panelCloseRef.current?.focus();
    };
    const handlePanelKeyDown = (event) => {
      if (event.key === 'Escape') setActivePanel(null);
      if (event.key === 'Tab') {
        const focusable = [...(panelRef.current?.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? [])].filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handlePanelKeyDown);
    focusPanel();
    return () => {
      window.removeEventListener('keydown', handlePanelKeyDown);
      const trigger = activePanel === 'solution'
        ? solutionButtonRef
        : activePanel === 'game-mode'
          ? promoModeButtonRef
          : helpButtonRef;
      trigger.current?.focus();
    };
  }, [activePanel]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenuOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeMenuOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      helpButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeMenuOnOutsideClick);
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ENSGdle · Géodata Paris';
    return () => { document.title = previousTitle; };
  }, []);

  const availablePromoYears = useMemo(
    () => [...new Set(students.map((student) => Number(student.promo)).filter(Number.isFinite))]
      .sort((a, b) => b - a),
    [students]
  );
  const promoPages = useMemo(() => {
    const pages = [];
    for (let index = 0; index < availablePromoYears.length; index += 8) {
      pages.push(availablePromoYears.slice(index, index + 8));
    }
    return pages;
  }, [availablePromoYears]);
  const playablePromoYears = useMemo(
    () => selectedPromoYears === null
      ? availablePromoYears
      : availablePromoYears.filter((promo) => selectedPromoYears.includes(promo)),
    [availablePromoYears, selectedPromoYears]
  );
  const playablePromoSet = useMemo(() => new Set(playablePromoYears), [playablePromoYears]);
  const currentEligibleStudents = useMemo(
    () => students.filter((student) => playablePromoSet.has(Number(student.promo))),
    [students, playablePromoSet]
  );
  const draftPromoYears = promoDraft ?? playablePromoYears;
  const draftPromoSet = useMemo(() => new Set(draftPromoYears), [draftPromoYears]);
  const draftStudents = useMemo(
    () => students.filter((student) => draftPromoSet.has(Number(student.promo))),
    [students, draftPromoSet]
  );
  const promoDraftCanPlay = useMemo(
    () => draftPromoYears.length >= 3 && hasPlayableChallenge(draftStudents, links),
    [draftPromoYears, draftStudents, links]
  );
  const currentGraph = useMemo(() => buildGameGraph(currentEligibleStudents, links), [currentEligibleStudents, links]);
  const currentDailyPeriod = dailyPeriodKey(challengeClock);
  const currentWeeklyPeriod = weeklyPeriodKey(challengeClock);
  const challengePeriod = archiveSelection?.mode === mode
    ? archiveSelection.periodKey
    : mode === 'daily'
      ? currentDailyPeriod
      : mode === 'weekly'
        ? currentWeeklyPeriod
        : 'practice:' + practiceSeed + ':' + round;
  const challengePromoYears = archiveSelection?.mode === mode && Array.isArray(archiveSelection.promoYears)
    ? archiveSelection.promoYears
    : playablePromoYears;
  const challengePromoSet = useMemo(() => new Set(challengePromoYears.map(Number)), [challengePromoYears]);
  const archiveKey = mode === 'practice' ? null : challengeArchiveKey(mode, challengePeriod, challengePromoYears);
  const frozenArchive = archiveKey ? frozenChallengeArchives[archiveKey] ?? null : null;
  const archiveGraphSnapshot = useMemo(() => ({
    nodes: students.map((student) => ({ ...student })),
    links: links.map((link) => ({ source: endpointId(link.source), target: endpointId(link.target) })),
  }), [students, links]);
  const graphSource = frozenArchive?.graph ?? archiveGraphSnapshot;
  const eligibleStudents = useMemo(
    () => graphSource.nodes.filter((student) => challengePromoSet.has(Number(student.promo))),
    [graphSource, challengePromoSet]
  );
  const challengeLinks = graphSource.links;
  const activePromoLabels = challengePromoYears.map((promo) => describePromo(promo, challengeClock).label);
  const activePromoLevels = activePromoLabels.map((label) => Number(label.match(/^IT(\d+)$/)?.[1]));
  const sortedPromoLevels = activePromoLevels.filter(Number.isFinite).sort((a, b) => a - b);
  const hasContiguousLevels = sortedPromoLevels.length === activePromoLabels.length
    && sortedPromoLevels.every((level, index) => index === 0 || level === sortedPromoLevels[index - 1] + 1);
  const promoModeRange = hasContiguousLevels && sortedPromoLevels.length > 1
    ? ['IT' + sortedPromoLevels[0], 'IT' + sortedPromoLevels[sortedPromoLevels.length - 1]]
    : null;
  const allPromosSelected = challengePromoYears.length === availablePromoYears.length;
  const promoModeLabel = allPromosSelected
    ? 'Toutes promos'
    : promoModeRange
      ? promoModeRange[0] + ' à ' + promoModeRange[1]
      : activePromoLabels.length <= 3
        ? activePromoLabels.join(' · ')
        : activePromoLabels.length + ' promos';
  const promoModeAccessibleLabel = 'Promos du jeu : ' + promoModeLabel + '. Modifier la sélection.';
  const graph = useMemo(() => buildGameGraph(eligibleStudents, challengeLinks), [eligibleStudents, challengeLinks]);
  const weeklyChallengeAvailable = useMemo(
    () => Boolean(getChallenge(graph, 'weekly', practiceSeed, round, currentWeeklyPeriod)?.constraint),
    [graph, practiceSeed, round, currentWeeklyPeriod]
  );
  const todayKey = parisDateKey(challengeClock);
  const firstArchiveDate = '2026-09-01';
  const archiveCalendarCells = getArchiveMonthCells(archiveMonth).map((periodKey) => {
    if (!periodKey) return null;
    const day = new Date(periodKey + 'T12:00:00Z');
    const available = periodKey >= firstArchiveDate && (archiveMode === 'daily'
      ? periodKey === todayKey || periodKey <= currentDailyPeriod
      : day.getUTCDay() === 1 && periodKey <= currentWeeklyPeriod);
    return { periodKey, day: day.getUTCDate(), available, isToday: periodKey === todayKey };
  });
  const currentArchiveMonth = new Date(todayKey + 'T12:00:00Z');
  const firstArchiveMonth = new Date('2026-09-01T12:00:00Z');
  const canGoToPreviousArchiveMonth = archiveMonth.getUTCFullYear() > firstArchiveMonth.getUTCFullYear()
    || (archiveMonth.getUTCFullYear() === firstArchiveMonth.getUTCFullYear()
      && archiveMonth.getUTCMonth() > firstArchiveMonth.getUTCMonth());
  const canAdvanceArchiveMonth = archiveMonth.getUTCFullYear() < currentArchiveMonth.getUTCFullYear()
    || (archiveMonth.getUTCFullYear() === currentArchiveMonth.getUTCFullYear()
      && archiveMonth.getUTCMonth() < currentArchiveMonth.getUTCMonth());
  const archivePreviewKey = archiveDate
    ? challengeArchiveKey(archiveMode, archiveDate, playablePromoYears)
    : null;
  const archivePreview = archivePreviewKey ? frozenChallengeArchives[archivePreviewKey] ?? null : null;
  const archiveChallenge = archivePreview?.challenge ?? (archiveDate
    ? getChallenge(currentGraph, archiveMode, 0, 0, archiveDate)
    : null);
  const archivePreviewGraph = useMemo(() => archivePreview
    ? buildGameGraph(
      archivePreview.graph.nodes.filter((student) => playablePromoYears.includes(Number(student.promo))),
      archivePreview.graph.links
    )
    : currentGraph, [archivePreview, playablePromoYears, currentGraph]);
  const archiveStart = archiveChallenge ? archivePreviewGraph.byId.get(archiveChallenge.startId) : null;
  const archiveEnd = archiveChallenge ? archivePreviewGraph.byId.get(archiveChallenge.endId) : null;
  useEffect(() => {
    if (selectedPromoYears === null || playablePromoYears.length >= 3) return;
    setSelectedPromoYears(null);
    try {
      window.localStorage.removeItem('ensgdle-playable-promos-v1');
    } catch {
      // Fall back to all promos for this session when browser storage is unavailable.
    }
  }, [selectedPromoYears, playablePromoYears]);
  const currentPeriodRef = useRef(challengePeriod);
  useEffect(() => {
    if (currentPeriodRef.current === challengePeriod) return;
    currentPeriodRef.current = challengePeriod;
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
  }, [challengePeriod]);

  const generatedChallenge = useMemo(
    () => getChallenge(
      graph,
      mode,
      practiceSeed,
      round,
      challengePeriod
    ),
    [graph, mode, practiceSeed, round, challengePeriod]
  );
  const challenge = frozenArchive?.challenge ?? generatedChallenge;
  useEffect(() => {
    let cancelled = false;
    const persistChallenge = async (snapshotMode, periodKey) => {
      const candidate = getChallenge(currentGraph, snapshotMode, 0, 0, periodKey);
      if (!candidate) return;
      const key = challengeArchiveKey(snapshotMode, periodKey, playablePromoYears);
      if (frozenChallengeArchives[key]) return;
      try {
        const record = await getOrFreezeChallengeArchive(
          snapshotMode,
          periodKey,
          playablePromoYears,
          candidate,
          archiveGraphSnapshot
        );
        if (!cancelled && record) {
          setFrozenChallengeArchives((current) => ({ ...current, [key]: record }));
        }
      } catch (error) {
        console.warn('[défis] Impossible de charger ou figer l’archive :', error.message);
      }
    };
    void Promise.all([
      persistChallenge('daily', currentDailyPeriod),
      persistChallenge('weekly', currentWeeklyPeriod),
    ]);
    return () => { cancelled = true; };
  }, [
    currentGraph,
    currentDailyPeriod,
    currentWeeklyPeriod,
    playablePromoYears,
    frozenChallengeArchives,
    archiveGraphSnapshot,
  ]);
  const startId = challenge?.startId;
  const endId = challenge?.endId;
  const requiredStudentId = challenge?.constraint?.type === 'through'
    ? challenge.constraint.studentId
    : null;
  const forbiddenStudentId = challenge?.constraint?.type === 'avoid'
    ? challenge.constraint.studentId
    : null;
  const start = graph.byId.get(startId);
  const end = graph.byId.get(endId);

  const visibleIds = useMemo(
    () => new Set([startId, endId, requiredStudentId, forbiddenStudentId, ...foundIds].filter(Boolean)),
    [startId, endId, requiredStudentId, forbiddenStudentId, foundIds]
  );
  const shownNodes = useMemo(
    () => [...visibleIds].map((id) => graph.byId.get(id)).filter(Boolean),
    [visibleIds, graph.byId]
  );
  const shortestPath = useMemo(
    () => challenge?.solutionPath ?? [],
    [challenge]
  );
  const nextHintStudent = shortestPath
    .slice(1, -1)
    .map((id) => graph.byId.get(id))
    .find((student) => student && !visibleIds.has(student.id));
  const previousHintStudent = shortestPath
    .slice(1, -1)
    .reverse()
    .map((id) => graph.byId.get(id))
    .find((student) => student && !visibleIds.has(student.id));
  const shortestPathEdgeKeys = useMemo(
    () => new Set(shortestPath.slice(1).map((target, index) => [shortestPath[index], target].sort().join('|'))),
    [shortestPath]
  );
  const shortestGraph = useMemo(() => ({
    ...graph,
    edges: graph.edges.filter((edge) => shortestPathEdgeKeys.has([edge.source, edge.target].sort().join('|'))),
  }), [graph, shortestPathEdgeKeys]);
  const shortestNodes = useMemo(
    () => shortestPath.map((id) => graph.byId.get(id)).filter(Boolean),
    [shortestPath, graph.byId]
  );
  const solutionPossibleIds = useMemo(() => new Set(shortestPath), [shortestPath]);
  const hintedNodes = useMemo(() => hintsUsed >= 3
    ? shortestNodes
    : hintedStudentIds.map((id) => graph.byId.get(id)).filter(Boolean),
  [hintsUsed, hintedStudentIds, shortestNodes, graph.byId]);
  const shortestPathData = useMemo(() => {
    if (!challenge) return { nodeIds: new Set(), edgeKeys: new Set() };

    if (challenge.constraint?.type === 'through') {
      return findShortestPathsThrough(
        graph.adjacency,
        startId,
        challenge.constraint.studentId,
        endId,
        null,
        challenge.distance
      );
    }

    const avoidId = challenge.constraint?.type === 'avoid'
      ? challenge.constraint.studentId
      : null;
    const permittedIds = avoidId
      ? new Set([...graph.adjacency.keys()].filter((id) => id !== avoidId))
      : null;
    const fromStart = buildDistances(graph.adjacency, startId, permittedIds);
    const fromEnd = buildDistances(graph.adjacency, endId, permittedIds);
    const nodeIds = new Set([...fromStart]
      .filter(([id, distance]) => distance + (fromEnd.get(id) ?? Infinity) === challenge.distance)
      .map(([id]) => id));
    const edgeKeys = new Set(graph.edges
      .filter((edge) => !permittedIds || (permittedIds.has(edge.source) && permittedIds.has(edge.target)))
      .filter((edge) => (
        fromStart.get(edge.source) + 1 + fromEnd.get(edge.target) === challenge.distance
        || fromStart.get(edge.target) + 1 + fromEnd.get(edge.source) === challenge.distance
      ))
      .map((edge) => [edge.source, edge.target].sort(compareIds).join('|')));
    return { nodeIds, edgeKeys };
  }, [graph.adjacency, graph.edges, challenge, startId, endId]);
  const shortestIds = shortestPathData.nodeIds;
  const shortestEdgeKeys = shortestPathData.edgeKeys;
  const possibleIds = useMemo(() => {
    const ids = new Set([startId, endId, requiredStudentId].filter(Boolean));
    const avoidId = challenge?.constraint?.type === 'avoid'
      ? challenge.constraint.studentId
      : null;
    const permittedIds = avoidId
      ? new Set([...graph.adjacency.keys()].filter((id) => id !== avoidId))
      : null;
    foundIds.forEach((id) => {
      if (challenge?.constraint?.type === 'through') {
        if (shortestIds.has(id)) ids.add(id);
        return;
      }
      if (permittedIds && !permittedIds.has(id)) return;
      if (isOnPossiblePath(graph.adjacency, startId, id, endId, permittedIds)) ids.add(id);
    });
    return ids;
  }, [graph.adjacency, startId, endId, requiredStudentId, foundIds, challenge, shortestIds]);
  const winningPath = useMemo(
    () => challenge ? findChallengePath(graph.adjacency, startId, endId, visibleIds, challenge.constraint) : [],
    [graph.adjacency, challenge, startId, endId, visibleIds]
  );
  const won = winningPath.length > 0
    && (hintsUsed < 3 || winningPath.length - 1 === challenge.distance);
  const shortestPathSolved = won && winningPath.length - 1 === challenge.distance;
  const baseCompletionPoints = mode === 'daily'
    ? (shortestPathSolved ? 10 : 5)
    : mode === 'weekly'
      ? (shortestPathSolved ? 20 : 10)
      : 0;
  const hintPenalty = (hintsUsed >= 1 ? 1 : 0)
    + (hintsUsed >= 2 ? 1 : 0)
    + (hintsUsed >= 3 ? 2 : 0);
  const completionPoints = Math.max(0, baseCompletionPoints - hintPenalty);
  const trackableCompletion = accountConnected
    && accountAuthUser?.id
    && (mode === 'daily' || mode === 'weekly')
    ? accountAuthUser.id + ':' + mode + ':' + challengePeriod
    : null;
  const currentCompletionRecord = completionRecord?.key === trackableCompletion
    ? completionRecord
    : null;
  useEffect(() => {
    if (!won || !trackableCompletion || recordedCompletionRef.current === trackableCompletion) return;
    recordedCompletionRef.current = trackableCompletion;
    setCompletionRecord({ key: trackableCompletion, status: 'saving' });
    recordPlayerChallengeCompletion(mode, challengePeriod, completionPoints)
      .then((result) => {
        if (!result) {
          setCompletionRecord({ key: trackableCompletion, status: 'failed' });
          return;
        }
        if (result.stats && accountAuthUser?.id) updatePlayerAccountStatsCache(accountAuthUser.id, result.stats);
        setCompletionRecord((current) => (
          current?.key === trackableCompletion && current.status === 'duplicate'
            ? current
            : {
              key: trackableCompletion,
              status: result.alreadyCompleted ? 'duplicate' : 'recorded',
            }
        ));
      })
      .catch((error) => {
        if (recordedCompletionRef.current === trackableCompletion) recordedCompletionRef.current = null;
        setCompletionRecord({ key: trackableCompletion, status: 'failed' });
        console.warn('[scores] Impossible d’enregistrer cette réussite :', error.message);
      });
  }, [won, trackableCompletion, mode, challengePeriod, completionPoints, accountAuthUser]);
  const attemptLimit = (challenge?.distance ?? 0) + 5;
  const lost = attemptCount > attemptLimit && !won;
  const displayedAttemptCount = Math.min(attemptCount, attemptLimit);
  const graphNodes = useMemo(() => {
    if (!lost) return shownNodes;
    const byId = new Map(shownNodes.map((student) => [student.id, student]));
    shortestNodes.forEach((student) => byId.set(student.id, student));
    return [...byId.values()];
  }, [lost, shownNodes, shortestNodes]);
  const graphPossibleIds = useMemo(() => (
    lost ? new Set([...possibleIds, ...shortestPath]) : possibleIds
  ), [lost, possibleIds, shortestPath]);

  const suggestions = useMemo(() => {
    if (!normalizeName(query)) return [];
    const candidates = eligibleStudents.filter((student) => !visibleIds.has(student.id));
    return searchStudentsByName(candidates, query).slice(0, 8);
  }, [eligibleStudents, query, visibleIds]);
  const selectableSuggestions = useMemo(
    () => suggestions.filter((student) => student.id !== forbiddenStudentId),
    [suggestions, forbiddenStudentId]
  );

  const clearRound = () => {
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
    if (mode === 'practice') setRound((value) => value + 1);
  };

  const selectMode = (nextMode, nextArchiveSelection = null) => {
    if (nextMode === mode && !archiveSelection && !nextArchiveSelection) return;
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    setMode(nextMode);
    setArchiveSelection(nextArchiveSelection);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
  };

  const rememberChallengeArchive = (record) => {
    if (!record?.mode || !record.period_key || !record.promo_years) return;
    const key = challengeArchiveKey(record.mode, record.period_key, record.promo_years);
    setFrozenChallengeArchives((current) => ({ ...current, [key]: record }));
  };

  const archiveChallengeForPeriod = async (archiveModeToLoad, periodKey, promoYears) => {
    const key = challengeArchiveKey(archiveModeToLoad, periodKey, promoYears);
    if (frozenChallengeArchives[key]) return frozenChallengeArchives[key];
    const candidate = getChallenge(currentGraph, archiveModeToLoad, 0, 0, periodKey);
    let record = null;
    try {
      record = await getOrFreezeChallengeArchive(
        archiveModeToLoad,
        periodKey,
        promoYears,
        candidate,
        archiveGraphSnapshot
      );
    } catch (error) {
      console.warn('[défis] Impossible de sauvegarder cette archive :', error.message);
    }
    if (!record && candidate) {
      record = {
        mode: archiveModeToLoad,
        period_key: periodKey,
        promo_years: [...promoYears],
        challenge: candidate,
        graph: archiveGraphSnapshot,
      };
    }
    rememberChallengeArchive(record);
    return record;
  };

  const openPromoSettings = () => {
    setPromoDraft([...challengePromoYears]);
    setMenuOpen(false);
    setActivePanel('game-mode');
  };

  const toggleDraftPromo = (promo) => {
    setPromoDraft((current) => {
      const selected = current ?? challengePromoYears;
      return selected.includes(promo)
        ? selected.filter((year) => year !== promo)
        : [...selected, promo].sort((a, b) => b - a);
    });
  };

  const applyPromoSettings = () => {
    const nextYears = availablePromoYears.filter((promo) => draftPromoSet.has(promo));
    const nextStudents = students.filter((student) => nextYears.includes(Number(student.promo)));
    if (nextYears.length < 3) return;
    if (!hasPlayableChallenge(nextStudents, links)) return;

    const nextGraph = buildGameGraph(nextStudents, links);
    const nextWeeklyChallengeAvailable = Boolean(
      getChallenge(nextGraph, 'weekly', practiceSeed, round, currentWeeklyPeriod)?.constraint
    );
    const includeAllPromos = nextYears.length === availablePromoYears.length;
    const storedSelection = includeAllPromos ? null : nextYears;
    setSelectedPromoYears(storedSelection);
    setArchiveSelection(null);
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    if (mode === 'weekly' && !nextWeeklyChallengeAvailable) {
      setMode('daily');
      setArchiveSelection(null);
    }
    setPromoDraft(null);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);

    try {
      if (includeAllPromos) window.localStorage.removeItem('ensgdle-playable-promos-v1');
      else window.localStorage.setItem('ensgdle-playable-promos-v1', JSON.stringify(nextYears));
    } catch {
      // Settings still apply for this session when browser storage is unavailable.
    }
  };

  const addStudent = (student) => {
    if (!student || !graph.byId.has(student.id) || won || lost || visibleIds.has(student.id)) return;
    if (student.id === forbiddenStudentId) {
      setFeedback(student.name + ' est interdit par la consigne de cette semaine.');
      return;
    }

    const connectsToShown = [...(graph.adjacency.get(student.id) ?? [])].some((id) => visibleIds.has(id));
    const onShortest = shortestIds.has(student.id);
    setAttemptCount((current) => current + 1);
    setFoundIds((current) => [...current, student.id]);
    setFeedback(
      onShortest
        ? challenge?.constraint
          ? student.name + ' est sur un chemin qui respecte la consigne.'
          : student.name + ' est sur un des chemins les plus courts.'
        : connectsToShown
          ? student.name + ' prolonge la chaîne affichée.'
          : student.name + ' est ajouté·e, mais ne rejoint pas encore les personnes affichées.'
    );
    setQuery('');
    setActiveSuggestion(0);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const exact = eligibleStudents.find((student) =>
      normalizeName(student.name) === normalizeName(query)
      && !visibleIds.has(student.id)
    );
    if (exact?.id === forbiddenStudentId) {
      setFeedback(exact.name + ' est interdit par la consigne de cette semaine.');
      return;
    }
    const choice = exact ?? selectableSuggestions[activeSuggestion];
    if (!choice) {
      const forbiddenMatch = suggestions.find((student) => student.id === forbiddenStudentId);
      setFeedback(forbiddenMatch
        ? forbiddenMatch.name + ' est interdit par la consigne de cette semaine.'
        : 'Aucun étudiant correspondant. Essaie un autre nom.');
      return;
    }
    addStudent(choice);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown' && selectableSuggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % selectableSuggestions.length);
    } else if (event.key === 'ArrowUp' && selectableSuggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index - 1 + selectableSuggestions.length) % selectableSuggestions.length);
    } else if (event.key === 'Escape') {
      setQuery('');
      setActiveSuggestion(0);
    }
  };

  const pairLabel = mode === 'daily' ? 'Défi du jour' : mode === 'weekly' ? 'Défi de la semaine' : 'Entraînement';
  const ruleStudent = challenge?.constraint
    ? graph.byId.get(challenge.constraint.studentId)
    : null;
  const challengeQuestion = ruleStudent && mode !== 'weekly'
    ? 'Peux-tu relier ces deux étudiants '
      + (challenge.constraint.type === 'through'
        ? 'en passant obligatoirement par '
        : 'sans passer par ')
      + ruleStudent.name
      + ' ?'
    : 'Peux-tu relier ces deux étudiants ?';

  return (
    <main className="game-page">
      <TopoBackground />
      <div className="game-page__content">
        <header className="game-page__header">
          <div className="game-page__brand">
            <div className="game-page__identity">
              <h1>ENSGdle</h1>
              <p>Jeu de parrainage <BrandDivider /> {pairLabel}</p>
            </div>
            <button
              ref={promoModeButtonRef}
              className="game-promo-mode"
              type="button"
              aria-haspopup="dialog"
              aria-label={promoModeAccessibleLabel}
              onClick={openPromoSettings}
            >
              <span>Promos</span>
              {promoModeRange && !allPromosSelected ? (
                <strong className="game-promo-mode__range">
                  <span>{promoModeRange[0]}</span>
                  <BrandDivider />
                  <span>{promoModeRange[1]}</span>
                </strong>
              ) : (
                <strong>{promoModeLabel}</strong>
              )}
            </button>
          </div>
          <nav className="game-modes" aria-label="Mode de jeu">
            <button type="button" className={mode === 'daily' ? 'is-active' : ''} onClick={() => selectMode('daily')}>Journalier</button>
            <button
              type="button"
              className={mode === 'weekly' ? 'is-active' : ''}
              onClick={() => selectMode('weekly')}
              disabled={!weeklyChallengeAvailable}
              aria-disabled={!weeklyChallengeAvailable}
              title={weeklyChallengeAvailable ? undefined : 'Pas assez de promos sélectionnées pour un défi hebdomadaire'}
            >
              Hebdomadaire
            </button>
            <button type="button" className={mode === 'practice' ? 'is-active' : ''} onClick={() => selectMode('practice')}>Entraînement</button>
          </nav>
          <div className="game-page__actions">
            <button
              className={'game-account-indicator'
                + (accountAuthReady && accountConnected ? ' is-connected' : '')
                + (accountAuthReady && !accountConnected ? ' is-disconnected' : '')}
              type="button"
              aria-label={!accountAuthReady
                ? 'Ouvrir le compte'
                : accountConnected
                  ? 'Compte connecté, ouvrir le compte'
                  : 'Compte non connecté, ouvrir la connexion'}
              title={!accountAuthReady
                ? 'Compte'
                : accountConnected
                  ? 'Compte connecté'
                  : 'Compte non connecté'}
              onClick={() => {
                setMenuOpen(false);
                setSelectedLeaderboardPlayer(null);
                setActivePanel('account');
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                <circle cx="10" cy="6.2" r="3" />
                <path d="M3.5 17c.5-3.3 3-5.3 6.5-5.3s6 2 6.5 5.3" />
              </svg>
              {accountAuthReady && <span className="game-account-indicator__dot" aria-hidden="true" />}
            </button>
            <a className="btn btn--ghost game-page__back" href="#" aria-label="Retour à l’arbre">
              <img className="game-page__back-home-icon" src={houseIcon} alt="" aria-hidden="true" />
              <span className="game-page__back-label"><span aria-hidden="true">←</span> Retour à l’arbre</span>
            </a>
            <div className="game-menu" ref={menuRef}>
              <button
                ref={helpButtonRef}
                className="btn btn--ghost game-menu__trigger"
                type="button"
                aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-expanded={menuOpen}
                aria-controls="game-menu-panel"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg aria-hidden="true" viewBox="0 0 18 18" focusable="false">
                  <path d="M1 4h16M1 9h16M1 14h16" />
                </svg>
              </button>
              {menuOpen && (
                <div className="game-menu__panel" id="game-menu-panel" role="group" aria-label="Menu du jeu">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActivePanel('help');
                    }}
                  >
                    Comment jouer&nbsp;?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setArchiveMode('daily');
                      setArchiveDate(null);
                      setArchiveMonth(new Date(Date.UTC(
                        currentArchiveMonth.getUTCFullYear(),
                        currentArchiveMonth.getUTCMonth(),
                        1
                      )));
                      setActivePanel('archive');
                    }}
                  >
                    Archives
                  </button>
                  <button type="button" onClick={openPromoSettings}>
                    Mode de jeu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActivePanel('account');
                    }}
                  >
                    Compte
                  </button>
                  {gameSuperadminSession && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setActivePanel('player-admin');
                      }}
                    >
                      Administration
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setSelectedLeaderboardPlayer(null);
                      setActivePanel('leaderboard');
                    }}
                  >
                    Classement
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {challenge && start && end ? (
          <div className="game-layout">
            <section className="game-challenge" aria-labelledby="game-challenge-title">
              <div className={'game-challenge__heading'
                + (challenge?.constraint && mode !== 'weekly' ? ' game-challenge__heading--constrained' : '')
                + (mode === 'weekly' ? ' game-challenge__heading--weekly' : '')}>
                <div>
                  {!(archiveSelection?.mode === 'weekly' && mode === 'weekly') && (
                    <p className={'game-section-kicker' + (mode === 'weekly' ? ' game-section-kicker--weekly' : '')}>{pairLabel}</p>
                  )}
                  {mode === 'weekly' && (
                    <p className="game-challenge__schedule">
                      {archiveSelection?.mode === mode
                        ? 'Semaine du ' + formatArchiveDate(challengePeriod)
                        : formatWeeklyReset(challengeClock)}
                    </p>
                  )}
                  <h2 id="game-challenge-title">{challengeQuestion}</h2>
                  {mode === 'weekly' && ruleStudent && (
                    <div className="game-weekly-rule-row">
                      <p className="game-weekly-rule__prompt">
                        {challenge.constraint.type === 'through' ? 'En passant par ' : 'Sans passer par '}
                        <strong>{ruleStudent.name}</strong>
                      </p>
                      <div
                        className={'game-weekly-rule'
                          + (challenge.constraint.type === 'avoid' ? ' game-weekly-rule--avoid' : '')}
                        role="note"
                      >
                        <span className="game-weekly-rule__label">
                          {challenge.constraint.type === 'through' ? 'Obligatoire' : 'Interdit'}
                        </span>
                        <ShapeSwatch promo={ruleStudent.promo} size={14} />
                        <span className="game-weekly-rule__copy">
                          <strong>{ruleStudent.name}</strong>
                          <small>{challenge.constraint.type === 'through'
                            ? 'À inclure dans la chaîne'
                            : 'À ne pas ajouter à la chaîne'}</small>
                        </span>
                      </div>
                    </div>
                  )}
                  {mode === 'daily' && (
                    <p className="game-challenge__schedule">
                      {archiveSelection?.mode === mode
                        ? formatArchiveDate(challengePeriod)
                        : 'Prochain défi dans ' + formatCountdown(getNextParisNoon(challengeClock) - challengeClock.getTime())}
                    </p>
                  )}
                </div>
              </div>
              <div className="game-endpoints">
                <article className="game-endpoint">
                  <ShapeSwatch promo={start.promo} size={25} />
                  <div><small>Départ</small><strong className={endpointNameClass(start.name)}>{start.name}</strong><span>{start.code || 'Promo'}{start.code ? String(start.promo).slice(-2) : ' ' + start.promo}</span></div>
                </article>
                <BrandDivider />
                <article className="game-endpoint">
                  <ShapeSwatch promo={end.promo} size={25} />
                  <div><small>Arrivée</small><strong className={endpointNameClass(end.name)}>{end.name}</strong><span>{end.code || 'Promo'}{end.code ? String(end.promo).slice(-2) : ' ' + end.promo}</span></div>
                </article>
              </div>
              <TopoDivider
                className="game-challenge__divider"
                lineIndex={mode === 'daily' ? 3 : mode === 'weekly' ? 7 : 11}
              />
            </section>

            <section className="game-graph" aria-labelledby="game-graph-title">
              <header className="game-graph__header">
                <div>
                  <p className="game-section-kicker">Graphe du défi</p>
                  <h2 id="game-graph-title">Connexions trouvées</h2>
                </div>
                <div className="game-graph__legend">
                  <span className="game-graph__legend-item"><i aria-hidden="true" /> Lien de famille</span>
                  <span className="game-graph__legend-item"><i className="game-graph__legend-shortest" /> Chemin le plus court</span>
                  <span className="game-graph__legend-item"><i className="game-graph__legend-off-path" /> Hors chemin</span>
                </div>
              </header>
              <GameGraph
                graph={graph}
                nodes={graphNodes}
                hintNodes={lost ? [] : hintedNodes}
                startId={startId}
                endId={endId}
                requiredId={requiredStudentId}
                forbiddenId={forbiddenStudentId}
                weeklyMode={mode === 'weekly'}
                practiceMode={mode === 'practice'}
                shortestIds={shortestIds}
                shortestEdgeKeys={shortestEdgeKeys}
                possibleIds={graphPossibleIds}
              />
            </section>

            <form className={'game-search' + (searchFocused ? ' is-focused' : '')} onSubmit={handleSubmit}>
              <div className="game-search__label-row">
                <label htmlFor="game-student-search">Ajoute un étudiant pour compléter l'arbre</label>
                <span>({displayedAttemptCount === 1 ? 'Tentative' : 'Tentatives'} {displayedAttemptCount}/{attemptLimit})</span>
              </div>
              <div className="game-search__controls">
                <div className="game-search__input-wrap">
                  <input
                    id="game-student-search"
                    type="search"
                    autoComplete="off"
                    value={query}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveSuggestion(0);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Rechercher un étudiant"
                    disabled={won || lost}
                  />
                  {suggestions.length > 0 && searchFocused && !won && !lost && (
                    <ul className="game-search__suggestions" role="listbox">
                      {suggestions.map((student) => {
                        const isForbidden = student.id === forbiddenStudentId;
                        const isActive = !isForbidden
                          && selectableSuggestions[activeSuggestion]?.id === student.id;
                        return (
                          <li key={student.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              disabled={isForbidden}
                              className={(isActive ? 'is-active' : '') + (isForbidden ? ' is-forbidden' : '')}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => addStudent(student)}
                            >
                              <span>{student.name}</span>
                              <small>{isForbidden
                                ? 'Interdit'
                                : (formatStudentAffiliations(student) || 'Promo ' + student.promo)}</small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <button className="btn btn--ghost game-search__submit" type="submit" disabled={won || lost || !query.trim()}>
                  Ajouter
                </button>
              </div>
            </form>

            <div className={'game-feedback' + (won ? ' game-feedback--won' : lost ? ' game-feedback--lost' : '')} role="status" aria-live="polite">
              {won
                ? <>
                    <span>Bravo ! Tu as trouvé une chaîne de {Math.max(0, winningPath.length - 1)} liens.</span>
                    {mode !== 'practice' && (
                      <strong className={'game-feedback__points' + (currentCompletionRecord?.status === 'duplicate' ? ' game-feedback__points--duplicate' : '')}>
                        {!trackableCompletion
                          ? `+${completionPoints} points`
                          : currentCompletionRecord?.status === 'recorded'
                            ? `+${completionPoints} points`
                            : currentCompletionRecord?.status === 'duplicate'
                              ? 'Défi déjà réalisé'
                              : currentCompletionRecord?.status === 'failed'
                                ? 'Points non confirmés'
                                : 'Vérification…'}
                      </strong>
                    )}
                  </>
                : lost
                  ? 'Tu as épuisé tes tentatives. Le chemin optimal est révélé sur le graphe.'
                  : feedback || (
                    <>
                      <span className="game-feedback__instruction--desktop">
                        Tu peux choisir parmi les promos sélectionnées <BrandDivider /> les liens montrent lesquels rejoignent la chaîne.
                      </span>
                      <span className="game-feedback__instruction--mobile">
                        Cherche parmi les promos choisies <BrandDivider /> le chemin le plus court
                      </span>
                    </>
                  )}
            </div>

            <div className="game-round-actions">
              <div className="game-hints" role="group" aria-label="Indices">
                {[1, 2, 3].map((hintIndex) => {
                  const used = hintIndex <= hintsUsed;
                  return (
                    <button
                      key={hintIndex}
                      type="button"
                      className={'btn btn--ghost game-hint' + (used ? ' is-used' : '')}
                      disabled={won || lost || hintIndex !== hintsUsed + 1}
                      aria-pressed={used}
                      aria-label={[
                        'Initiales du prochain nœud',
                        'Initiales du dernier nœud avant l’arrivée',
                        'Chemin complet en initiales',
                      ][hintIndex - 1]}
                      onClick={() => {
                        if (hintIndex === 1 && nextHintStudent) {
                          setHintedStudentIds([nextHintStudent.id]);
                        }
                        if (hintIndex === 2) {
                          if (previousHintStudent) {
                            setHintedStudentIds((current) => [...new Set([...current, previousHintStudent.id])]);
                          }
                        }
                        setHintsUsed(hintIndex);
                      }}
                    >
                      {['Initiales prochain nœud', 'Initiales dernier nœud', 'Chemin en initiales'][hintIndex - 1]}
                    </button>
                  );
                })}
              </div>
              {mode === 'practice' && (
                <button type="button" className="btn btn--ghost game-round-actions__new-game" onClick={clearRound}>
                  Nouvelle partie
                </button>
              )}
              <div className="game-round-actions__links">
                <span
                  className="game-help-link-tooltip"
                  data-tooltip={!won && hintsUsed < 3 ? 'disponible après indices' : undefined}
                >
                  <button
                    type="button"
                    className="game-help-link game-help-link--button"
                    ref={solutionButtonRef}
                    onClick={() => setActivePanel('solution')}
                    aria-haspopup="dialog"
                    disabled={!won && hintsUsed < 3}
                  >
                    Voir le chemin optimal
                  </button>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <section className="game-empty" role="status">
            <h2>Aucun défi disponible</h2>
            <p>Il faut au moins deux liens entre des étudiants pour créer un défi. Vérifie les liens de parrainage dans la base.</p>
          </section>
        )}

        {activePanel && (
          <div
            className="game-help-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setActivePanel(null);
            }}
          >
            <section
              ref={panelRef}
              className={'game-help-panel'
                + (activePanel === 'solution' ? ' game-help-panel--solution' : '')
                + (activePanel === 'help' ? ' game-help-panel--help' : '')
                + (activePanel === 'game-mode' ? ' game-help-panel--game-mode' : '')
                + (activePanel === 'account' ? ' game-help-panel--account' : '')
                + (activePanel === 'player-admin' ? ' game-help-panel--player-admin' : '')
                + (activePanel === 'leaderboard' ? ' game-help-panel--leaderboard' : '')
                + (activePanel === 'archive' ? ' game-help-panel--archive' : '')}
              role="dialog"
              aria-modal="true"
              aria-labelledby="game-panel-title"
              tabIndex="-1"
            >
              <button
                ref={panelCloseRef}
                type="button"
                className={'game-help-panel__close'
                  + (activePanel === 'help' ? ' game-help-panel__close--help' : '')
                  + (activePanel === 'solution' ? ' game-help-panel__close--solution' : '')}
                onClick={() => setActivePanel(null)}
                aria-label="Fermer le panneau"
              >
                ×
              </button>
              {activePanel === 'help' ? (
                <>
                  <p className="game-section-kicker">Règles</p>
                  <h2 id="game-panel-title">Comment jouer&nbsp;?</h2>
                  <ol>
                    <li>Relie l'étudiant de départ et d'arrivée.</li>
                    <li>Trouve des liens parmi les familles de l'école.</li>
                    <li>Le lien est jaune si c'est le chemin le plus court.</li>
                    <li>Plusieurs chemins peuvent exister.</li>
                    <li>Tu gagnes dès qu'un chemin continu relie le départ et l'arrivée.</li>
                  </ol>
                  <section className="game-help-example game-graph" aria-labelledby="game-help-example-title">
                    <header className="game-graph__header game-help-example__header">
                      <div><h3 id="game-help-example-title">Exemple de parcours</h3></div>
                      <div className="game-graph__legend" aria-label="Légende de l'exemple">
                        <span className="game-graph__legend-item"><i aria-hidden="true" /> Lien de famille</span>
                        <span className="game-graph__legend-item"><i className="game-graph__legend-shortest" aria-hidden="true" /> Chemin le plus court</span>
                        <span className="game-graph__legend-item"><i className="game-graph__legend-off-path" aria-hidden="true" /> Hors chemin</span>
                      </div>
                    </header>
                    <GameGraph
                      graph={HELP_EXAMPLE_GRAPH}
                      nodes={HELP_EXAMPLE_NODES}
                      startId={HELP_EXAMPLE_START_ID}
                      endId={HELP_EXAMPLE_END_ID}
                      requiredId={null}
                      shortestIds={HELP_EXAMPLE_SHORTEST_IDS}
                      shortestEdgeKeys={HELP_EXAMPLE_SHORTEST_EDGE_KEYS}
                      possibleIds={HELP_EXAMPLE_POSSIBLE_IDS}
                      orderedIds={HELP_EXAMPLE_ORDERED_IDS}
                      ariaLabel="Graphe d'exemple"
                    />
                  </section>
                </>
              ) : activePanel === 'game-mode' ? (
                <>
                  <p className="game-section-kicker">Mode de jeu</p>
                  <h2 id="game-panel-title">Promos jouables</h2>
                  <p className="game-promo-settings__intro">
                    Seuls les étudiants et les liens des promos sélectionnées pourront apparaître dans les défis.
                  </p>
                  <div className="game-promo-settings__select-actions">
                    <button type="button" onClick={() => setPromoDraft([...availablePromoYears])}>
                      Tout sélectionner
                    </button>
                    <button type="button" onClick={() => setPromoDraft([])}>
                      Tout désélectionner
                    </button>
                  </div>
                  <div
                    className="game-promo-settings__list"
                    role="group"
                    aria-label="Promos utilisables dans le jeu"
                  >
                    {promoPages.map((page, pageIndex) => (
                      <div className="game-promo-settings__page" key={pageIndex}>
                        {page.map((promo) => {
                          const selected = draftPromoSet.has(promo);
                          return (
                            <label
                              key={promo}
                              className={'game-promo-settings__option' + (selected ? ' is-selected' : '')}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleDraftPromo(promo)}
                              />
                              <span>
                                <strong>{describePromo(promo, challengeClock).label}</strong>
                                <small>Promo {promo}</small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <p className="game-promo-settings__status" role="status" aria-live="polite">
                    {draftPromoYears.length < 3
                      ? 'Sélectionne au moins trois promos pour jouer.'
                      : promoDraftCanPlay
                        ? 'Le jeu sera limité aux promos sélectionnées.'
                        : 'Cette sélection ne permet pas de relier deux étudiants par un chemin de jeu.'}
                  </p>
                  <div className="game-promo-settings__footer">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setPromoDraft(null);
                        setActivePanel(null);
                      }}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={applyPromoSettings}
                      disabled={!promoDraftCanPlay}
                    >
                      Appliquer
                    </button>
                  </div>
                </>
              ) : activePanel === 'player-admin' ? (
                <>
                  <p className="game-section-kicker">Superadmin</p>
                  <h2 id="game-panel-title">Gestion des comptes</h2>
                  <PlayerAccountAdminPanel
                    session={gameSuperadminSession}
                    onSession={setGameSuperadminSession}
                  />
                </>
              ) : activePanel === 'account' ? (
                <>
                  <div className="game-account-panel__eyebrow">
                    <p className="game-section-kicker">Espace joueur</p>
                  </div>
                  <h2 id="game-panel-title">{accountAuthReady ? (accountConnected ? 'Mon compte' : 'Connexion') : 'Compte'}</h2>
                  <PlayerAccountPanel
                    initialMode={accountInitialMode}
                    onInitialModeReset={() => setAccountInitialMode('login')}
                    onConnectionChange={setAccountConnected}
                    onAuthReady={() => setAccountAuthReady(true)}
                    knownAuthReady={accountAuthReady}
                    knownUser={accountAuthUser}
                  />
                </>
              ) : activePanel === 'leaderboard' ? (
                selectedLeaderboardPlayer ? (
                  <>
                    <p className="game-section-kicker">Profil joueur</p>
                    <h2 id="game-panel-title" className="game-leaderboard__profile-pseudo">{selectedLeaderboardPlayer.pseudo}</h2>
                    <div className="game-leaderboard__profile-school">
                      <span className="game-leaderboard__profile-name">{selectedLeaderboardPlayer.firstName} {selectedLeaderboardPlayer.lastName}</span>
                      <span>{selectedLeaderboardPlayer.promo}</span>
                      {selectedLeaderboardPlayer.filiere && (
                        <>
                          <BrandDivider />
                          <span>{selectedLeaderboardPlayer.filiere}</span>
                        </>
                      )}
                    </div>
                    <p className="game-leaderboard__intro">Statistiques des défis enregistrés · profil en lecture seule</p>
                    <div className="game-leaderboard__profile-stats" aria-label={'Statistiques de ' + selectedLeaderboardPlayer.pseudo}>
                      <div><strong>{selectedLeaderboardPlayer.daily}</strong><span>Défis quotidiens</span></div>
                      <div><strong>{selectedLeaderboardPlayer.weekly}</strong><span>Défis hebdomadaires</span></div>
                      <div><strong>{selectedLeaderboardPlayer.score.toLocaleString('fr-FR')}</strong><span>Points</span></div>
                    </div>
                    <button type="button" className="game-leaderboard__back" onClick={() => setSelectedLeaderboardPlayer(null)}>← Retour au classement</button>
                  </>
                ) : (
                  <>
                    <p className="game-section-kicker">Scores des joueurs</p>
                    <h2 id="game-panel-title">Classement</h2>
                    <p className="game-leaderboard__intro">Classement actualisé à partir des défis réussis.</p>
                    {leaderboardLoading && <p className="game-leaderboard__status" role="status">Chargement du classement…</p>}
                    {leaderboardError && <p className="game-leaderboard__status game-leaderboard__status--error" role="alert">{leaderboardError}</p>}
                    {!leaderboardLoading && !leaderboardError && leaderboardPlayers.length === 0 && (
                      <p className="game-leaderboard__status">Aucun joueur inscrit pour le moment.</p>
                    )}
                    {leaderboardPlayers.length > 0 && <ol className="game-leaderboard" aria-label="Classement des joueurs">
                      {leaderboardPlayers.map((player, index) => (
                        <li className={index < 3 ? 'game-leaderboard__row game-leaderboard__row--top' : 'game-leaderboard__row'} key={player.pseudo}>
                          <button
                            type="button"
                            className="game-leaderboard__open"
                            aria-label={'Voir le profil et les statistiques de ' + player.pseudo}
                            onClick={() => {
                              if (player.isCurrentUser) {
                                setSelectedLeaderboardPlayer(null);
                                setActivePanel('account');
                              } else {
                                setSelectedLeaderboardPlayer(player);
                              }
                            }}
                          >
                            <span className="game-leaderboard__rank">{index + 1}</span>
                            <span className="game-leaderboard__pseudo">{player.pseudo}</span>
                            <strong className="game-leaderboard__score">{player.score.toLocaleString('fr-FR')} pts</strong>
                          </button>
                        </li>
                      ))}
                    </ol>}
                  </>
                )
              ) : activePanel === 'archive' ? (
                <>
                  <p className="game-section-kicker">Archives</p>
                  <h2 id="game-panel-title">Anciens défis</h2>
                  <p className="game-archive__intro">Choisis un défi quotidien ou hebdomadaire à rejouer.</p>

                  <div className="game-archive__modes" role="group" aria-label="Type de défi archivé">
                    <button
                      type="button"
                      className={archiveMode === 'daily' ? 'is-active' : ''}
                      aria-pressed={archiveMode === 'daily'}
                      onClick={() => {
                        setArchiveMode('daily');
                        setArchiveDate(null);
                      }}
                    >
                      Journalier
                    </button>
                    <button
                      type="button"
                      className={archiveMode === 'weekly' ? 'is-active' : ''}
                      aria-pressed={archiveMode === 'weekly'}
                      onClick={() => {
                        setArchiveMode('weekly');
                        setArchiveDate(null);
                      }}
                    >
                      Hebdomadaire
                    </button>
                  </div>

                  <div className="game-archive__calendar">
                    <div className="game-archive__month">
                      <button
                        type="button"
                        aria-label="Mois précédent"
                        disabled={!canGoToPreviousArchiveMonth}
                        onClick={() => {
                          setArchiveDate(null);
                          setArchiveMonth((current) => new Date(Date.UTC(
                            current.getUTCFullYear(),
                            current.getUTCMonth() - 1,
                            1
                          )));
                        }}
                      >
                        ‹
                      </button>
                      <h3 aria-live="polite">{formatArchiveMonth(archiveMonth)}</h3>
                      <button
                        type="button"
                        aria-label="Mois suivant"
                        disabled={!canAdvanceArchiveMonth}
                        onClick={() => {
                          setArchiveDate(null);
                          setArchiveMonth((current) => new Date(Date.UTC(
                            current.getUTCFullYear(),
                            current.getUTCMonth() + 1,
                            1
                          )));
                        }}
                      >
                        ›
                      </button>
                    </div>
                    <div className="game-archive__weekdays" aria-hidden="true">
                      {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="game-archive__days">
                      {archiveCalendarCells.map((cell, index) => {
                        if (!cell) {
                          return <span className="game-archive__empty-day" key={'empty-' + index} aria-hidden="true" />;
                        }
                        const selected = archiveDate === cell.periodKey;
                        const archiveLabel = (archiveMode === 'weekly' ? 'Semaine du ' : 'Défi du ')
                          + formatArchiveDate(cell.periodKey)
                          + (cell.isToday ? ' (aujourd’hui)' : '');
                        return (
                          <button
                            key={cell.periodKey}
                            type="button"
                            className={'game-archive__day'
                              + (cell.available ? ' is-available' : '')
                              + (cell.isToday ? ' is-today' : '')
                              + (selected ? ' is-selected' : '')}
                            disabled={!cell.available}
                            aria-label={archiveLabel}
                            aria-pressed={selected}
                            onClick={() => {
                              const isCurrentChallenge = archiveMode === 'daily'
                                ? cell.isToday
                                : cell.periodKey === currentWeeklyPeriod;
                              const selectedPeriod = isCurrentChallenge
                                ? archiveMode === 'daily' ? currentDailyPeriod : currentWeeklyPeriod
                                : cell.periodKey;
                              const scope = [...playablePromoYears].sort((a, b) => a - b);
                              if (isCurrentChallenge && mode === archiveMode && !archiveSelection) {
                                setActivePanel(null);
                                setMenuOpen(false);
                              } else {
                                selectMode(archiveMode, isCurrentChallenge
                                  ? null
                                  : { mode: archiveMode, periodKey: selectedPeriod, promoYears: scope });
                              }
                              archiveChallengeForPeriod(archiveMode, selectedPeriod, scope).catch((error) => {
                                console.warn('[défis] Impossible de charger cette archive :', error.message);
                              });
                            }}
                          >
                            {cell.day}
                          </button>
                        );
                      })}
                    </div>
                    <p className="game-archive__hint game-archive__hint--range">
                      {archiveMode === 'daily'
                        ? 'Défis quotidiens disponibles depuis le 1er septembre 2026.'
                        : 'Défis hebdomadaires disponibles depuis le 1er septembre 2026.'}
                    </p>
                  </div>

                  {archiveDate && (!archiveChallenge || !archiveStart || !archiveEnd) && (
                    <p className="game-archive__hint" aria-live="polite">
                      Ce défi n’est pas disponible avec les données actuelles.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="game-section-kicker">Solution</p>
                  <h2 id="game-panel-title">{challenge?.constraint ? 'Solution du défi' : 'Chemin le plus court'}</h2>
                  <p className="game-solution__summary">
                    {Math.max(0, shortestPath.length - 1)} liens
                    {challenge?.constraint ? ' en respectant la consigne' : ' entre le départ et l’arrivée'}
                  </p>
                  <p className="game-solution__note">
                    {challenge?.constraint
                      ? 'Il peut exister d’autres chemins aussi courts qui respectent la consigne.'
                      : 'Il peut exister d’autres chemins aussi courts.'}
                  </p>
                  <GameGraph
                    graph={shortestGraph}
                    nodes={shortestNodes}
                    startId={startId}
                    endId={endId}
                    requiredId={requiredStudentId}
                    shortestIds={shortestIds}
                    shortestEdgeKeys={shortestPathEdgeKeys}
                    possibleIds={solutionPossibleIds}
                    orderedIds={shortestPath}
                    solutionLayout
                    ariaLabel={challenge?.constraint ? 'Graphe de la solution du défi' : 'Graphe du chemin le plus court'}
                  />
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
