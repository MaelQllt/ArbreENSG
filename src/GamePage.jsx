import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import houseIcon from './assets/house.svg';
import BrandDivider from './components/BrandDivider';
import ShapeSwatch from './components/ShapeSwatch';
import TopoBackground, { TopoDivider } from './components/TopoBackground';
import { describePromo, formatStudentAffiliations } from './lib/promo';
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

function dailyPeriodKey(date) {
  return dateKey(parisEffectiveDate(date));
}

function weeklyPeriodKey(date) {
  const effectiveDate = parisEffectiveDate(date);
  const daysSinceMonday = (effectiveDate.getUTCDay() + 6) % 7;
  effectiveDate.setUTCDate(effectiveDate.getUTCDate() - daysSinceMonday);
  return dateKey(effectiveDate);
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

function challengeSignature(challenge) {
  if (!challenge) return '';
  const forwardPath = challenge.solutionPath.join('>');
  const reversePath = [...challenge.solutionPath].reverse().join('>');
  return [
    [challenge.startId, challenge.endId].sort(compareIds).join('|'),
    challenge.constraint?.type ?? '',
    challenge.constraint?.studentId ?? '',
    [forwardPath, reversePath].sort()[0],
  ].join('::');
}

const normalizeName = (value) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

function getStudentInitials(name) {
  const [firstName, ...surnameParts] = name.trim().split(/\s+/);
  return [firstName, surnameParts.join(' ')]
    .filter(Boolean)
    .map((part) => Array.from(part)[0].toLocaleUpperCase('fr') + '…')
    .join(' ');
}

function GameGraph({ graph, nodes, hintNodes = EMPTY_GRAPH_HINTS, startId, endId, requiredId, shortestIds, shortestEdgeKeys, possibleIds, orderedIds, solutionLayout = false, ariaLabel = 'Graphe des personnes trouvées' }) {
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
        };
      });
      const priority = (line) => (line.shortest ? 2 : line.possible ? 1 : 0);
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
  }, [graph.edges, graph.byId, visibleIds, renderedIds, groups, shortestEdgeKeys, possibleIds, widestPromoRow, solutionLayout]);

  return (
    <>
      <div
        ref={viewportRef}
        className={'game-graph__viewport'
          + (solutionLayout ? ' game-graph__viewport--solution' : '')
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
                  + (!line.possible ? ' game-graph__edge--off-path' : '')}
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
                            + (isShortest ? ' game-node--shortest' : '')
                            + (isHinted ? ' game-node--hinted' : '')
                            + (isOffPath ? ' game-node--off-path' : '')
                            + (displayedName.length >= 26 ? ' game-node--very-long-name'
                              : displayedName.length >= 18 ? ' game-node--long-name' : '')}
                          aria-label={isHinted
                            ? 'Indice : ' + getStudentInitials(student.name)
                            : isRequired ? student.name + ', passage obligatoire' : undefined}
                        >
                          {stepIndex > 0 && <span className="game-node__step" aria-hidden="true">{stepIndex}</span>}
                          <ShapeSwatch promo={student.promo} size={20} />
                          <span className="game-node__copy">
                            <strong>{displayedName}</strong>
                            {isRequired && <small>Passage obligatoire</small>}
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
          <span className="game-graph__scroll-arrow game-graph__scroll-arrow--left" aria-hidden="true" />
          <span>Faites glisser pour voir tout le graphe</span>
          <span className="game-graph__scroll-arrow game-graph__scroll-arrow--right" aria-hidden="true" />
        </p>
      )}
    </>
  );
}

export default function GamePage({ students, links }) {
  const [mode, setMode] = useState('daily');
  const [round, setRound] = useState(0);
  const [attemptCount, setAttemptCount] = useState(1);
  const [weeklyPreviewIndex, setWeeklyPreviewIndex] = useState(0);
  const [challengeClock, setChallengeClock] = useState(() => new Date());
  const [practiceSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [foundIds, setFoundIds] = useState([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintedStudentIds, setHintedStudentIds] = useState([]);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const helpButtonRef = useRef(null);
  const solutionButtonRef = useRef(null);
  const panelRef = useRef(null);
  const panelCloseRef = useRef(null);

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
        event.preventDefault();
        focusPanel();
      }
    };
    window.addEventListener('keydown', handlePanelKeyDown);
    focusPanel();
    return () => {
      window.removeEventListener('keydown', handlePanelKeyDown);
      const trigger = activePanel === 'help' ? helpButtonRef : solutionButtonRef;
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

  const graph = useMemo(() => buildGameGraph(students, links), [students, links]);
  const challengePeriod = mode === 'daily'
    ? dailyPeriodKey(challengeClock)
    : mode === 'weekly'
      ? weeklyPeriodKey(challengeClock)
      : 'practice:' + practiceSeed + ':' + round;
  const currentPeriodRef = useRef(challengePeriod);
  useEffect(() => {
    if (currentPeriodRef.current === challengePeriod) return;
    currentPeriodRef.current = challengePeriod;
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setWeeklyPreviewIndex(0);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
  }, [challengePeriod]);

  const challenge = useMemo(
    () => getChallenge(
      graph,
      mode,
      practiceSeed,
      round,
      challengePeriod,
      weeklyPreviewIndex
    ),
    [graph, mode, practiceSeed, round, challengePeriod, weeklyPreviewIndex]
  );
  const startId = challenge?.startId;
  const endId = challenge?.endId;
  const requiredStudentId = challenge?.constraint?.type === 'through'
    ? challenge.constraint.studentId
    : null;
  const start = graph.byId.get(startId);
  const end = graph.byId.get(endId);

  const visibleIds = useMemo(
    () => new Set([startId, endId, requiredStudentId, ...foundIds].filter(Boolean)),
    [startId, endId, requiredStudentId, foundIds]
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
    const normalized = normalizeName(query);
    if (!normalized) return [];
    return students
      .filter((student) =>
        !visibleIds.has(student.id)
        && normalizeName(student.name).includes(normalized)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .slice(0, 8);
  }, [students, query, visibleIds]);
  const forbiddenStudentId = challenge?.constraint?.type === 'avoid'
    ? challenge.constraint.studentId
    : null;
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

  const selectMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setAttemptCount(1);
    setWeeklyPreviewIndex(0);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
  };

  const addStudent = (student) => {
    if (!student || won || lost || visibleIds.has(student.id)) return;
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
    const exact = students.find((student) =>
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

  const generateWeeklyPreview = () => {
    if (mode !== 'weekly' || !challenge) return;
    const currentSignature = challengeSignature(challenge);
    let variant = weeklyPreviewIndex;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      variant += 1;
      const candidate = getChallenge(
        graph,
        'weekly',
        practiceSeed,
        round,
        challengePeriod,
        variant
      );
      if (
        candidate?.constraint
        && challengeSignature(candidate) !== currentSignature
      ) {
        setWeeklyPreviewIndex(variant);
        setFoundIds([]);
        setHintsUsed(0);
        setHintedStudentIds([]);
        setAttemptCount(1);
        setQuery('');
        setFeedback('');
        setActiveSuggestion(0);
        setActivePanel(null);
        return;
      }
    }
    setFeedback('Aucun autre scénario hebdomadaire disponible pour cette base.');
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
  const challengeQuestion = ruleStudent
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
          <div className="game-page__identity">
            <h1>ENSGdle</h1>
            <p>Jeu de parrainage <BrandDivider /> {pairLabel}</p>
          </div>
          <nav className="game-modes" aria-label="Mode de jeu">
            <button type="button" className={mode === 'daily' ? 'is-active' : ''} onClick={() => selectMode('daily')}>Journalier</button>
            <button type="button" className={mode === 'weekly' ? 'is-active' : ''} onClick={() => selectMode('weekly')}>Hebdomadaire</button>
            <button type="button" className={mode === 'practice' ? 'is-active' : ''} onClick={() => selectMode('practice')}>Entraînement</button>
          </nav>
          <div className="game-page__actions">
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
                </div>
              )}
            </div>
          </div>
        </header>

        {challenge && start && end ? (
          <div className="game-layout">
            <section className="game-challenge" aria-labelledby="game-challenge-title">
              <div className={'game-challenge__heading' + (challenge?.constraint ? ' game-challenge__heading--constrained' : '')}>
                <div>
                  <p className="game-section-kicker">{pairLabel}</p>
                  <h2 id="game-challenge-title">{challengeQuestion}</h2>
                  {mode === 'daily' && (
                    <p className="game-challenge__schedule">
                      Prochain défi dans {formatCountdown(getNextParisNoon(challengeClock) - challengeClock.getTime())}
                    </p>
                  )}
                  {mode === 'weekly' && (
                    <p className="game-challenge__schedule">{formatWeeklyReset(challengeClock)}</p>
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
                ? 'Bravo ! Tu as trouvé une chaîne de ' + Math.max(0, winningPath.length - 1) + ' liens.'
                : lost
                  ? 'Tu as épuisé tes tentatives. Le chemin optimal est révélé sur le graphe.'
                  : feedback || (
                    <>
                      <span className="game-feedback__instruction--desktop">
                        Tu peux choisir parmi tous les étudiants <BrandDivider /> les liens montrent lesquels rejoignent la chaîne.
                      </span>
                      <span className="game-feedback__instruction--mobile">
                        Trouve parmi les étudiants <BrandDivider /> le chemin le plus court
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
              {mode === 'weekly' && (
                <button type="button" className="btn btn--ghost" onClick={generateWeeklyPreview} hidden>
                  Générer un autre défi hebdo
                </button>
              )}
              <div className="game-round-actions__links">
                <span
                  className="game-help-link-tooltip"
                  data-tooltip={hintsUsed < 3 ? 'disponible après indices' : undefined}
                >
                  <button
                    type="button"
                    className="game-help-link game-help-link--button"
                    ref={solutionButtonRef}
                    onClick={() => setActivePanel('solution')}
                    aria-haspopup="dialog"
                    disabled={hintsUsed < 3}
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
                + (activePanel === 'help' ? ' game-help-panel--help' : '')}
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
