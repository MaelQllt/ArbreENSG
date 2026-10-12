const compareIds = (a, b) => {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
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

function endpointId(value) {
  return typeof value === 'object' && value !== null ? value.id : value;
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
    const edgeKey = [source, target].sort(compareIds).join('|');
    if (seenEdges.has(edgeKey)) return;
    seenEdges.add(edgeKey);
    edges.push({ source, target });
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  });

  const validPairs = [];
  students.forEach((student, index) => {
    const distances = buildDistances(adjacency, student.id);
    students.slice(index + 1).forEach((other) => {
      const distance = distances.get(other.id);
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
    return orientChallenge(pair, seed, null, findPath(gameGraph.adjacency, pair.startId, pair.endId));
  }

  if (mode === 'weekly') {
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
            if (!detour.length || detour.length < shortest.length + minimumDetour || detour.length > 10) continue;
            const extraStudents = detour.slice(1, -1).filter((id) => !shortest.includes(id));
            for (const studentId of extraStudents) {
              const routeThroughStudent = findPathThrough(gameGraph.adjacency, pair.startId, studentId, pair.endId);
              if (routeThroughStudent.length >= shortest.length + minimumDetour && routeThroughStudent.length <= 10) {
                return { pair, constraint: { type: 'through', studentId }, solutionPath: routeThroughStudent };
              }
            }
          }
          continue;
        }
        for (const studentId of interior) {
          const permittedIds = new Set([...gameGraph.adjacency.keys()].filter((id) => id !== studentId));
          const detour = findPath(gameGraph.adjacency, pair.startId, pair.endId, permittedIds);
          if (detour.length < shortest.length + minimumDetour || detour.length > 10) continue;
          return { pair, constraint: { type: 'avoid', studentId }, solutionPath: detour };
        }
      }
      return null;
    };
    const scenario = findScenario(preferredType) ?? findScenario(preferredType === 'avoid' ? 'through' : 'avoid');
    if (scenario) return orientChallenge(scenario.pair, seed, scenario.constraint, scenario.solutionPath);
    const pair = orderedPairs[0] ?? sorted[hash % sorted.length];
    return orientChallenge(pair, seed, null, findPath(gameGraph.adjacency, pair.startId, pair.endId));
  }

  const pair = sorted[hash % sorted.length];
  return orientChallenge(pair, seed, null, findPath(gameGraph.adjacency, pair.startId, pair.endId));
}

export { buildDistances, buildGameGraph, compareIds, findPath, findPathThrough, getChallenge, hashString, isOnPossiblePath };
