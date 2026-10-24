import { buildDistances, compareIds, findPath, findPathThrough } from '../../supabase/functions/_shared/gameChallengeCore';

export const endpointId = (value) => (typeof value === 'object' ? value.id : value);

export function findHintPath(adjacency, startId, endId, edgeKeys, checkpoints, distanceLimit) {
  if (!startId || !endId || !edgeKeys?.size || !Number.isFinite(distanceLimit)) return [];
  const requiredIds = [...new Set(checkpoints.filter((id) => id && id !== startId && id !== endId))];
  const queue = [{ id: startId, path: [startId], visited: new Set([startId]) }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const usedEdges = current.path.length - 1;
    if (current.id === endId) {
      if (usedEdges === distanceLimit && requiredIds.every((id) => current.visited.has(id))) {
        return current.path;
      }
      continue;
    }
    if (usedEdges >= distanceLimit) continue;

    for (const next of [...(adjacency.get(current.id) ?? [])].sort(compareIds)) {
      const edgeKey = [current.id, next].sort(compareIds).join('|');
      if (!edgeKeys.has(edgeKey) || current.visited.has(next)) continue;
      const visited = new Set(current.visited);
      visited.add(next);
      queue.push({ id: next, path: [...current.path, next], visited });
    }
  }
  return [];
}

export function findChallengePath(adjacency, startId, endId, allowedIds, constraint) {
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

export function findShortestPathsThrough(adjacency, startId, viaId, endId, allowedIds, distanceLimit) {
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

export function hasPlayableChallenge(students, links) {
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
