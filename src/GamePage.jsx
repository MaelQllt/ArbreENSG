import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import BrandDivider from './components/BrandDivider';
import ShapeSwatch from './components/ShapeSwatch';
import TopoBackground, { TopoDivider } from './components/TopoBackground';
import { describePromo } from './lib/promo';
import './GamePage.css';

const endpointId = (value) => (typeof value === 'object' ? value.id : value);

function buildDistances(adjacency, startId) {
  const distance = new Map([[startId, 0]]);
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of adjacency.get(current) ?? []) {
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
    for (const next of adjacency.get(current) ?? []) {
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

// Un étudiant appartient à un chemin simple entre les deux bornes si deux
// routes intérieurement disjointes le relient à chacune des bornes.
function isOnPossiblePath(adjacency, startId, candidateId, endId) {
  if (candidateId === startId || candidateId === endId) return true;
  const ids = [...adjacency.keys()];
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
      const [start, end] = [student, other].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
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

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function weekKey(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(monday);
}

function getChallenge(pairs, mode, practiceSeed, round, byId) {
  if (!pairs.length) return null;
  const sorted = [...pairs].sort((a, b) => {
    const aKey = [byId.get(a.startId)?.name, byId.get(a.endId)?.name].sort().join('|');
    const bKey = [byId.get(b.startId)?.name, byId.get(b.endId)?.name].sort().join('|');
    return aKey.localeCompare(bKey);
  });
  const now = new Date();
  const seed = mode === 'daily'
    ? 'daily:' + dateKey(now)
    : mode === 'weekly'
      ? 'weekly:' + weekKey(now)
      : 'practice:' + practiceSeed + ':' + round;
  const hash = hashString(seed);
  const pair = sorted[hash % sorted.length];
  return hashString(seed + ':direction') % 2
    ? { ...pair, startId: pair.endId, endId: pair.startId }
    : pair;
}

const normalizeName = (value) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

function GameGraph({ graph, nodes, startId, endId, shortestIds, shortestEdgeKeys, possibleIds, orderedIds, ariaLabel = 'Graphe des personnes trouvées' }) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const planeRef = useRef(null);
  const levelsRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [layout, setLayout] = useState({ width: 0, height: 0, scale: 1, lines: [] });
  const scaleRef = useRef(1);
  scaleRef.current = layout.scale;

  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const stepNumbers = useMemo(
    () => orderedIds ? new Map(orderedIds.map((id, index) => [id, index + 1])) : null,
    [orderedIds]
  );
  const groups = useMemo(() => {
    const orderIndex = orderedIds ? new Map(orderedIds.map((id, index) => [id, index])) : null;
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const byPromo = new Map();
    nodes.forEach((node) => {
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
    for (let pass = 0; pass < (orderIndex ? 0 : 8); pass += 1) {
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

    // Improve the row order by counting actual edge crossings, then keep any
    // adjacent swap that reduces them. Links are undirected, so count each
    // pair of promo rows once regardless of the stored edge direction.
    const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
    const countCrossings = () => {
      const positions = new Map([...ordered].map(([promo, members]) => [
        promo,
        new Map(members.map((node, index) => [node.id, {
          index,
          position: members.length > 1 ? index / (members.length - 1) : 0.5,
        }])),
      ]));
      const levelSegments = new Map();
      let sameLevelSpan = 0;
      visibleEdges.forEach((edge) => {
        const source = graph.byId.get(edge.source);
        const target = graph.byId.get(edge.target);
        if (!source || !target) return;
        if (source.promo === target.promo) {
          const row = positions.get(source.promo);
          const sourcePosition = row?.get(edge.source)?.index;
          const targetPosition = row?.get(edge.target)?.index;
          if (sourcePosition !== undefined && targetPosition !== undefined) {
            sameLevelSpan += Math.max(0, Math.abs(sourcePosition - targetPosition) - 1);
          }
          return;
        }
        const [topPromo, bottomPromo] = [source.promo, target.promo].sort((a, b) => a - b);
        const topIndex = positions.get(topPromo)?.get(source.promo === topPromo ? edge.source : edge.target)?.position;
        const bottomIndex = positions.get(bottomPromo)?.get(source.promo === bottomPromo ? edge.source : edge.target)?.position;
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
      return crossings * (visibleEdges.length * nodes.length + 1) + sameLevelSpan;
    };

    for (let pass = 0; pass < 8; pass += 1) {
      let improved = false;
      presentPromos.forEach((promo) => {
        const members = ordered.get(promo);
        for (let index = 0; index < members.length - 1; index += 1) {
          const currentCrossings = countCrossings();
          [members[index], members[index + 1]] = [members[index + 1], members[index]];
          const swappedCrossings = countCrossings();
          if (swappedCrossings < currentCrossings) {
            improved = true;
          } else {
            [members[index], members[index + 1]] = [members[index + 1], members[index]];
          }
        }
      });
      if (!improved) break;
    }
    return promos.map((promo) => [promo, ordered.get(promo) ?? []]);
  }, [nodes, graph.edges, graph.adjacency, graph.byId, orderedIds]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const plane = planeRef.current;
    const levels = levelsRef.current;
    if (!viewport || !canvas || !plane || !levels) return undefined;

    const update = () => {
      const availableWidth = Math.max(1, viewport.clientWidth);
      const availableHeight = Math.max(1, viewport.clientHeight);
      const width = Math.max(1, plane.offsetWidth || availableWidth);
      const height = Math.max(1, plane.offsetHeight);
      const scale = Math.min(1, availableWidth / width, availableHeight / height);
      const planeRect = plane.getBoundingClientRect();
      const renderedScale = scaleRef.current || 1;
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
            laneGroup: vertical
              ? 'v:' + [sourcePromo, targetPromo].sort((a, b) => a - b).join('|')
              : 'h:' + sourcePromo,
            lanePosition: vertical
              ? (sourceCenterX + targetCenterX) / 2
              : (sourceCenterY + targetCenterY) / 2,
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
        const maxSpread = Math.min(54, narrowestPort * 0.56);
        const step = ports.length > 1 ? Math.min(14, maxSpread / (ports.length - 1)) : 0;
        ports.forEach((port, index) => {
          const offset = (index - (ports.length - 1) / 2) * step;
          portOffsets.set(bucketKey + '\u0000' + port.edgeKey, offset);
        });
      });

      // Give each connection between the same pair of levels its own gentle
      // curve. This separates parallel branches instead of stacking them.
      const laneOffsets = new Map();
      const laneGroups = new Map();
      descriptors.forEach((descriptor) => {
        if (!laneGroups.has(descriptor.laneGroup)) laneGroups.set(descriptor.laneGroup, []);
        laneGroups.get(descriptor.laneGroup).push(descriptor);
      });
      laneGroups.forEach((edgesInLane) => {
        edgesInLane.sort((a, b) => a.lanePosition - b.lanePosition || a.edgeKey.localeCompare(b.edgeKey));
        const spread = Math.min(112, Math.max(0, (edgesInLane.length - 1) * 18));
        const step = edgesInLane.length > 1 ? spread / (edgesInLane.length - 1) : 0;
        edgesInLane.forEach((descriptor, index) => {
          laneOffsets.set(descriptor.edgeKey, (index - (edgesInLane.length - 1) / 2) * step);
        });
      });

      const lines = descriptors.map((descriptor) => {
        const {
          edge, edgeKey, vertical, sourceWidth, sourceHeight, targetWidth, targetHeight,
          sourceCenterX, sourceCenterY, targetCenterX, targetCenterY,
        } = descriptor;
        const sourceSide = vertical
          ? (targetCenterY > sourceCenterY ? 'bottom' : 'top')
          : (targetCenterX > sourceCenterX ? 'right' : 'left');
        const targetSide = vertical
          ? (targetCenterY > sourceCenterY ? 'top' : 'bottom')
          : (targetCenterX > sourceCenterX ? 'left' : 'right');
        const sourceOffset = portOffsets.get(edge.source + '\u0000' + sourceSide + '\u0000' + edgeKey) ?? 0;
        const targetOffset = portOffsets.get(edge.target + '\u0000' + targetSide + '\u0000' + edgeKey) ?? 0;
        const laneOffset = vertical ? (laneOffsets.get(edgeKey) ?? 0) : 0;
        let x1;
        let y1;
        let x2;
        let y2;
        let c1x;
        let c1y;
        let c2x;
        let c2y;

        if (vertical) {
          const direction = Math.sign(targetCenterY - sourceCenterY);
          x1 = sourceCenterX + sourceOffset;
          y1 = sourceCenterY + direction * sourceHeight / 2;
          x2 = targetCenterX + targetOffset;
          y2 = targetCenterY - direction * targetHeight / 2;
          const dx = x2 - x1;
          const bend = Math.min(72, Math.abs(y2 - y1) * 0.42);
          c1x = x1 + dx * 0.22 + laneOffset;
          c1y = y1 + direction * bend;
          c2x = x2 - dx * 0.22 + laneOffset;
          c2y = y2 - direction * bend;
        } else {
          const direction = Math.sign(targetCenterX - sourceCenterX) || 1;
          x1 = sourceCenterX + direction * sourceWidth / 2;
          y1 = sourceCenterY + sourceOffset;
          x2 = targetCenterX - direction * targetWidth / 2;
          y2 = targetCenterY + targetOffset;
          const bend = Math.min(72, Math.abs(x2 - x1) * 0.38);
          c1x = x1 + direction * bend;
          c1y = y1 + (y2 - y1) * 0.3 + laneOffset;
          c2x = x2 - direction * bend;
          c2y = y2 - (y2 - y1) * 0.3 + laneOffset;
        }

        return {
          key: edge.source + '>' + edge.target,
          d: 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2,
          shortest: shortestEdgeKeys.has(edgeKey),
          possible: possibleIds.has(edge.source) && possibleIds.has(edge.target),
        };
      });
      const priority = (line) => (line.shortest ? 2 : line.possible ? 1 : 0);
      lines.sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
      setLayout({ width, height, scale, lines });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(levels);
    nodeRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [graph.edges, visibleIds, groups, shortestEdgeKeys, possibleIds]);

  return (
    <div ref={viewportRef} className="game-graph__viewport" role="region" aria-label={ariaLabel}>
      <div
        ref={canvasRef}
        className="game-graph__canvas"
        style={{ height: layout.height ? layout.height * layout.scale : '100%' }}
      >
        <div
          ref={planeRef}
          className="game-graph__plane"
          style={{ '--graph-scale': layout.scale }}
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
          <div ref={levelsRef} className="game-graph__levels">
          {groups.map(([promo, members]) => {
            const promoInfo = describePromo(promo);
            return (
              <section className="game-graph__level" key={promo} aria-label={'Promotion ' + promo}>
                <header className="game-graph__level-title">
                  <span>{promoInfo.label}</span>
                  <BrandDivider />
                  <span>Promo {promo}</span>
                </header>
                <div className={'game-graph__nodes'
                  + (members.length === 0 ? ' game-graph__nodes--empty'
                    : members.length >= 5 ? ' game-graph__nodes--dense'
                    : members.length >= 3 ? ' game-graph__nodes--many'
                      : members.length === 1 ? ' game-graph__nodes--single'
                        : ' game-graph__nodes--pair')}>
                  {members.map((student) => {
                    const isStart = student.id === startId;
                    const isEnd = student.id === endId;
                    const isShortest = shortestIds.has(student.id);
                    const isOffPath = !possibleIds.has(student.id);
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
                          + (isShortest ? ' game-node--shortest' : '')
                          + (isOffPath ? ' game-node--off-path' : '')}
                      >
                        {stepIndex > 0 && <span className="game-node__step" aria-hidden="true">{stepIndex}</span>}
                        <ShapeSwatch promo={student.promo} size={members.length >= 5 ? 16 : members.length >= 3 ? 18 : 20} />
                        <span className="game-node__copy">
                          <strong>{student.name}</strong>
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
  );
}

export default function GamePage({ students, links }) {
  const [mode, setMode] = useState('daily');
  const [round, setRound] = useState(0);
  const [practiceSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [foundIds, setFoundIds] = useState([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [activePanel, setActivePanel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const helpButtonRef = useRef(null);
  const solutionButtonRef = useRef(null);
  const panelCloseRef = useRef(null);

  useEffect(() => {
    if (!activePanel) return undefined;
    const handlePanelKeyDown = (event) => {
      if (event.key === 'Escape') setActivePanel(null);
      if (event.key === 'Tab') {
        event.preventDefault();
        panelCloseRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handlePanelKeyDown);
    panelCloseRef.current?.focus();
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
  const challenge = useMemo(
    () => getChallenge(graph.validPairs, mode, practiceSeed, round, graph.byId),
    [graph.validPairs, graph.byId, mode, practiceSeed, round]
  );
  const startId = challenge?.startId;
  const endId = challenge?.endId;
  const start = graph.byId.get(startId);
  const end = graph.byId.get(endId);

  const visibleIds = useMemo(
    () => new Set([startId, endId, ...foundIds].filter(Boolean)),
    [startId, endId, foundIds]
  );
  const shownNodes = useMemo(
    () => [...visibleIds].map((id) => graph.byId.get(id)).filter(Boolean),
    [visibleIds, graph.byId]
  );
  const shortestPath = useMemo(
    () => challenge ? findPath(graph.adjacency, startId, endId) : [],
    [graph.adjacency, challenge, startId, endId]
  );
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
  const shortestIds = useMemo(() => {
    if (!challenge) return new Set();
    const fromStart = buildDistances(graph.adjacency, startId);
    const fromEnd = buildDistances(graph.adjacency, endId);
    return new Set([...fromStart]
      .filter(([id, distance]) => distance + (fromEnd.get(id) ?? Infinity) === challenge.distance)
      .map(([id]) => id));
  }, [graph.adjacency, challenge, startId, endId]);
  const shortestEdgeKeys = useMemo(() => {
    if (!challenge) return new Set();
    const fromStart = buildDistances(graph.adjacency, startId);
    const fromEnd = buildDistances(graph.adjacency, endId);
    return new Set(graph.edges
      .filter((edge) => (
        fromStart.get(edge.source) + 1 + fromEnd.get(edge.target) === challenge.distance
        || fromStart.get(edge.target) + 1 + fromEnd.get(edge.source) === challenge.distance
      ))
      .map((edge) => [edge.source, edge.target].sort().join('|')));
  }, [graph.edges, graph.adjacency, challenge, startId, endId]);
  const possibleIds = useMemo(() => {
    const ids = new Set([startId, endId].filter(Boolean));
    foundIds.forEach((id) => {
      if (isOnPossiblePath(graph.adjacency, startId, id, endId)) ids.add(id);
    });
    return ids;
  }, [graph.adjacency, startId, endId, foundIds]);
  const winningPath = useMemo(
    () => challenge ? findPath(graph.adjacency, startId, endId, visibleIds) : [],
    [graph.adjacency, challenge, startId, endId, visibleIds]
  );
  const won = winningPath.length > 0;

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

  const clearRound = () => {
    setFoundIds([]);
    setHintsUsed(0);
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
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
  };

  const addStudent = (student) => {
    if (!student || won || visibleIds.has(student.id)) return;

    const connectsToShown = [...(graph.adjacency.get(student.id) ?? [])].some((id) => visibleIds.has(id));
    const onShortest = shortestIds.has(student.id);
    setFoundIds((current) => [...current, student.id]);
    setFeedback(
      onShortest
        ? student.name + ' est sur un des chemins les plus courts.'
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
    const choice = exact ?? suggestions[activeSuggestion];
    if (!choice) {
      setFeedback('Aucun étudiant correspondant. Essaie un autre nom.');
      return;
    }
    addStudent(choice);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Escape') {
      setQuery('');
      setActiveSuggestion(0);
    }
  };

  const pairLabel = mode === 'daily' ? 'Défi du jour' : mode === 'weekly' ? 'Défi de la semaine' : 'Entraînement';

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
              <span aria-hidden="true">←</span> Retour à l’arbre
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
              <div className="game-challenge__heading">
                <div>
                  <p className="game-section-kicker">{pairLabel}</p>
                  <h2 id="game-challenge-title">Qui relie ces deux étudiants&nbsp;?</h2>
                </div>
              </div>
              <div className="game-endpoints">
                <article className="game-endpoint">
                  <ShapeSwatch promo={start.promo} size={25} />
                  <div><small>Départ</small><strong>{start.name}</strong><span>{start.code || 'Promo'}{start.code ? String(start.promo).slice(-2) : ' ' + start.promo}</span></div>
                </article>
                <BrandDivider />
                <article className="game-endpoint">
                  <ShapeSwatch promo={end.promo} size={25} />
                  <div><small>Arrivée</small><strong>{end.name}</strong><span>{end.code || 'Promo'}{end.code ? String(end.promo).slice(-2) : ' ' + end.promo}</span></div>
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
                nodes={shownNodes}
                startId={startId}
                endId={endId}
                shortestIds={shortestIds}
                shortestEdgeKeys={shortestEdgeKeys}
                possibleIds={possibleIds}
              />
            </section>

            <form className="game-search" onSubmit={handleSubmit}>
              <label htmlFor="game-student-search">Ajoute un étudiant pour compléter l'arbre</label>
              <div className="game-search__controls">
                <div className="game-search__input-wrap">
                  <input
                    id="game-student-search"
                    type="search"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveSuggestion(0);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Rechercher un étudiant"
                    disabled={won}
                  />
                  {suggestions.length > 0 && !won && (
                    <ul className="game-search__suggestions" role="listbox">
                      {suggestions.map((student, index) => (
                        <li key={student.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={activeSuggestion === index}
                            className={activeSuggestion === index ? 'is-active' : ''}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => addStudent(student)}
                          >
                            <span>{student.name}</span>
                            <small>{student.code || 'Promo'}{student.code ? String(student.promo).slice(-2) : ' ' + student.promo}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="btn btn--ghost game-search__submit" type="submit" disabled={won || !query.trim()}>
                  Ajouter
                </button>
              </div>
            </form>

            <div className={'game-feedback' + (won ? ' game-feedback--won' : '')} role="status" aria-live="polite">
              {won
                ? 'Bravo ! Tu as trouvé une chaîne de ' + Math.max(0, winningPath.length - 1) + ' liens.'
                : feedback || (
                  <span>
                    Tu peux choisir parmi tous les étudiants <BrandDivider /> les liens montrent lesquels rejoignent la chaîne.
                  </span>
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
                      disabled={hintIndex !== hintsUsed + 1}
                      aria-pressed={used}
                      onClick={() => setHintsUsed(hintIndex)}
                    >
                      Indice {hintIndex}
                    </button>
                  );
                })}
              </div>
              {mode === 'practice' && (
                <button type="button" className="btn btn--ghost" onClick={clearRound}>
                  Nouvelle partie
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
              className={'game-help-panel' + (activePanel === 'solution' ? ' game-help-panel--solution' : '')}
              role="dialog"
              aria-modal="true"
              aria-labelledby="game-panel-title"
            >
              <button
                ref={panelCloseRef}
                type="button"
                className="game-help-panel__close"
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
                    <li>Choisis des noms dans la recherche pour compléter la chaîne.</li>
                    <li>Les traits montrent les liens directs entre les étudiants affichés.</li>
                    <li>Les symboles indiquent leur promotion. Le jaune marque le chemin le plus court, les nœuds grisés ne sont sur aucun chemin possible.</li>
                    <li>Tu gagnes dès qu’un chemin continu relie le départ à l’arrivée.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="game-section-kicker">Solution</p>
                  <h2 id="game-panel-title">Chemin le plus court</h2>
                  <p className="game-solution__summary">{Math.max(0, shortestPath.length - 1)} liens entre le départ et l’arrivée</p>
                  <p className="game-solution__note">Il peut exister d’autres chemins aussi courts.</p>
                  <GameGraph
                    graph={shortestGraph}
                    nodes={shortestNodes}
                    startId={startId}
                    endId={endId}
                    shortestIds={shortestIds}
                    shortestEdgeKeys={shortestPathEdgeKeys}
                    possibleIds={new Set(shortestPath)}
                    orderedIds={shortestPath}
                    ariaLabel="Graphe du chemin le plus court"
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
