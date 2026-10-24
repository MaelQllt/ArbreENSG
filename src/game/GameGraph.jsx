import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import BrandDivider from '../components/BrandDivider';
import ShapeSwatch from '../components/ShapeSwatch';
import { describePromo } from '../lib/promo';
import { endpointId } from './gamePaths';

function forceNodeCollision(gap = 6) {
  let nodes = [];
  const force = (alpha) => {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
        const first = nodes[firstIndex];
        for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
          const second = nodes[secondIndex];
          const dx = (second.x + second.vx) - (first.x + first.vx);
          const dy = (second.y + second.vy) - (first.y + first.vy);
          const overlapX = (first.width + second.width) / 2 + gap - Math.abs(dx);
          const overlapY = (first.height + second.height) / 2 + gap - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;

          const direction = dx === 0
            ? (first.id < second.id ? 1 : -1)
            : Math.sign(dx);
          const firstIsFixed = first.fx != null;
          const secondIsFixed = second.fx != null;
          const impulse = overlapX * alpha * 0.72;
          if (firstIsFixed && !secondIsFixed) {
            second.vx += direction * impulse;
          } else if (secondIsFixed && !firstIsFixed) {
            first.vx -= direction * impulse;
          } else if (!firstIsFixed && !secondIsFixed) {
            first.vx -= direction * impulse * 0.5;
            second.vx += direction * impulse * 0.5;
          }
        }
      }
    }
  };
  force.initialize = (simulationNodes) => { nodes = simulationNodes; };
  return force;
}

function separateOverlappingNodes(nodes, gap = 6) {
  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
      const first = nodes[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
        const second = nodes[secondIndex];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const overlapX = (first.width + second.width) / 2 + gap - Math.abs(dx);
        const overlapY = (first.height + second.height) / 2 + gap - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const overlap = overlapX + 0.01;
        const direction = dx === 0
          ? (first.id < second.id ? 1 : -1)
          : Math.sign(dx);
        const firstFixed = first.fx != null;
        const secondFixed = second.fx != null;
        if (firstFixed && !secondFixed) {
          second.x += direction * overlap;
        } else if (secondFixed && !firstFixed) {
          first.x -= direction * overlap;
        } else if (!firstFixed && !secondFixed) {
          first.x -= direction * overlap / 2;
          second.x += direction * overlap / 2;
        }

        if (!firstFixed && first.vx * direction > 0) first.vx *= -0.2;
        if (!secondFixed && second.vx * direction < 0) second.vx *= -0.2;
      }
    }
  }
}

const EMPTY_GRAPH_HINTS = Object.freeze([]);

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


function getStudentInitials(name) {
  const [firstName, ...surnameParts] = name.trim().split(/\s+/);
  return [firstName, surnameParts.join(' ')]
    .filter(Boolean)
    .map((part) => Array.from(part)[0].toLocaleUpperCase('fr') + '…')
    .join(' ');
}

const gameNodeNameMeasureContext = typeof document !== 'undefined'
  ? document.createElement('canvas').getContext('2d')
  : null;

function getSolutionNodeNameFontSize(name, nodeWidth, hasStep) {
  const rootFontSize = typeof document !== 'undefined'
    ? Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
    : 16;
  const largeScreen = typeof window !== 'undefined' && window.innerWidth >= 1800;
  const largeNode = nodeWidth >= 250;
  const maxFontSize = rootFontSize * (name.length >= 26
    ? largeNode ? largeScreen ? 0.74 : 0.7 : largeScreen ? 0.7 : 0.62
    : name.length >= 18
      ? largeNode ? largeScreen ? 0.8 : 0.76 : largeScreen ? 0.78 : 0.68
      : largeNode ? largeScreen ? 0.92 : 0.88 : largeScreen ? 0.9 : 0.79);
  const availableWidth = Math.max(1, nodeWidth - (largeNode
    ? hasStep ? 92 : 57
    : hasStep ? 83 : 52));
  if (!gameNodeNameMeasureContext) return maxFontSize;
  gameNodeNameMeasureContext.font = `700 ${maxFontSize}px Roboto, sans-serif`;
  const textWidth = gameNodeNameMeasureContext.measureText(name).width;
  return Math.max(6, Math.min(maxFontSize, (maxFontSize * availableWidth) / Math.max(1, textWidth)));
}

export default function GameGraph({ graph, nodes, hintNodes = EMPTY_GRAPH_HINTS, startId, endId, requiredId, forbiddenId = null, weeklyMode = false, practiceMode = false, shortestIds, shortestEdgeKeys, possibleIds, orderedIds, solutionLayout = false, elasticDrag = false, ariaLabel = 'Graphe des personnes trouvées' }) {
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
  const [nodeOffsets, setNodeOffsets] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const nodeOffsetsRef = useRef({});
  const elasticNodesRef = useRef(new Map());
  const elasticSimulationRef = useRef(null);
  const elasticScaleRef = useRef(1);
  const dragRef = useRef(null);
  const returnFrameRef = useRef(0);
  const graphUpdateRef = useRef(null);

  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const renderedNodes = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    hintNodes.forEach((node) => {
      if (!byId.has(node.id)) byId.set(node.id, node);
    });
    return [...byId.values()];
  }, [nodes, hintNodes]);
  const renderedIds = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
  const saveNodeOffsets = (offsets) => {
    nodeOffsetsRef.current = offsets;
    setNodeOffsets(offsets);
  };
  const getElasticNode = (nodeId) => elasticNodesRef.current.get(nodeId);
  const keepPromoNodesApart = (node, targetX) => {
    let safeX = targetX;
    elasticNodesRef.current.forEach((other) => {
      if (other.id === node.id || other.promo !== node.promo) return;
      const separation = (node.width + other.width) / 2 + 6;
      const otherX = other.fx != null ? other.fx : other.x + other.vx;
      if (node.baseX < other.baseX) safeX = Math.min(safeX, otherX - separation);
      else safeX = Math.max(safeX, otherX + separation);
    });
    return safeX;
  };
  const heatElasticGraph = (alpha = 0.45) => {
    const simulation = elasticSimulationRef.current;
    if (!simulation) return;
    simulation.alpha(Math.max(simulation.alpha(), alpha)).alphaTarget(0.22).restart();
  };
  const finishElasticDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const node = getElasticNode(drag.nodeId);
    const simulation = elasticSimulationRef.current;
    dragRef.current = null;
    setDraggingNodeId(null);
    if (!node || !simulation) return;
    node.fx = null;
    node.fy = null;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      simulation.stop();
      elasticNodesRef.current.forEach((elasticNode) => {
        elasticNode.x = elasticNode.baseX;
        elasticNode.y = elasticNode.baseY;
        elasticNode.vx = 0;
        elasticNode.vy = 0;
      });
      saveNodeOffsets({});
      return;
    }
    node.vx = Math.max(-10, Math.min(10, node.vx + drag.velocityX * 0.011));
    node.vy = Math.max(-8, Math.min(8, node.vy + drag.velocityY * 0.011));
    simulation.alpha(Math.max(simulation.alpha(), 0.32)).alphaTarget(0).restart();
  };
  const handleElasticPointerDown = (event, nodeId) => {
    if (!elasticDrag || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const node = getElasticNode(nodeId);
    if (!node || !elasticSimulationRef.current) return;
    window.cancelAnimationFrame(returnFrameRef.current);
    returnFrameRef.current = 0;
    node.fx = node.x;
    node.fy = node.y;
    dragRef.current = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      targetX: node.x,
      targetY: node.y,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocityX: 0,
      velocityY: 0,
    };
    setDraggingNodeId(nodeId);
    heatElasticGraph(0.62);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handleElasticPointerMove = (event) => {
    const drag = dragRef.current;
    if (!elasticDrag || !drag || drag.pointerId !== event.pointerId) return;
    const node = getElasticNode(drag.nodeId);
    const simulation = elasticSimulationRef.current;
    if (!node || !simulation) return;
    const scale = Math.max(0.01, elasticScaleRef.current);
    const rangeX = 190 / scale;
    const rangeY = 18 / scale;
    const dragGainX = 1.5;
    const dragGainY = 1.25;
    const desiredX = Math.max(
      node.baseX - rangeX,
      Math.min(node.baseX + rangeX, drag.originX + ((event.clientX - drag.startX) * dragGainX) / scale)
    );
    drag.targetX = keepPromoNodesApart(node, desiredX);
    drag.targetY = Math.max(
      node.baseY - rangeY,
      Math.min(node.baseY + rangeY, drag.originY + ((event.clientY - drag.startY) * dragGainY) / scale)
    );
    node.fx = drag.targetX;
    node.fy = drag.targetY;
    node.x = drag.targetX;
    node.y = drag.targetY;

    const now = performance.now();
    const elapsed = Math.max(12, now - drag.lastAt);
    const velocityX = ((event.clientX - drag.lastX) * dragGainX / scale) * 1000 / elapsed;
    const velocityY = ((event.clientY - drag.lastY) * dragGainY / scale) * 1000 / elapsed;
    drag.velocityX = drag.velocityX * 0.55 + velocityX * 0.45;
    drag.velocityY = drag.velocityY * 0.55 + velocityY * 0.45;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    heatElasticGraph(0.5);
  };
  const handleElasticPointerEnd = (event) => {
    if (!dragRef.current || (event?.pointerId != null && dragRef.current.pointerId !== event.pointerId)) return;
    finishElasticDrag();
  };
  const handleElasticKeyDown = (event, nodeId) => {
    if (!elasticDrag || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const node = getElasticNode(nodeId);
    if (!node) return;
    if (!dragRef.current) {
      window.cancelAnimationFrame(returnFrameRef.current);
      returnFrameRef.current = 0;
      node.fx = node.x;
      node.fy = node.y;
      dragRef.current = {
        nodeId,
        pointerId: null,
        originX: node.x,
        originY: node.y,
        targetX: node.x,
        targetY: node.y,
        velocityX: 0,
        velocityY: 0,
      };
    }
    if (dragRef.current.nodeId !== nodeId) return;
    const scale = Math.max(0.01, elasticScaleRef.current);
    const step = 18 / scale;
    const drag = dragRef.current;
    const nextX = drag.targetX + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0);
    const nextY = drag.targetY + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    const desiredX = Math.max(node.baseX - 190 / scale, Math.min(node.baseX + 190 / scale, nextX));
    drag.targetX = keepPromoNodesApart(node, desiredX);
    drag.targetY = Math.max(node.baseY - 18 / scale, Math.min(node.baseY + 18 / scale, nextY));
    node.fx = drag.targetX;
    node.fy = drag.targetY;
    node.x = node.fx;
    node.y = node.fy;
    setDraggingNodeId(nodeId);
    heatElasticGraph(0.5);
  };
  const handleElasticKeyUp = (event) => {
    if (!elasticDrag || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (dragRef.current?.pointerId === null) finishElasticDrag();
  };
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
  const largeScreenLayout = typeof window !== 'undefined' && window.innerWidth >= 1800;
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
      const largeScreen = window.innerWidth >= 1800;
      const compactSolution = solutionLayout && window.innerWidth <= 767;
      const mobileSolution = compactSolution && compact;
      const titleColumnWidth = mobileSolution ? 0 : compactSolution ? 84 : compact ? 0 : largeScreen ? 142 : 128;
      const titleGap = mobileSolution ? 0 : compactSolution ? 6 : compact ? 0 : largeScreen ? 14 : 12;
      const edgeGutter = compact ? 40 : largeScreen ? 80 : 72;
      const columnGap = compact || compactSolution ? 8 : largeScreen ? 16 : 14;
      const mobileNodeMinWidth = 112;
      const mobileNodeMaxWidth = 128;
      const mobileFitNodeWidth = (availableWidth - edgeGutter - Math.max(0, widestPromoRow - 1) * columnGap) / widestPromoRow;
      const horizontalScroll = mobileSolution && mobileFitNodeWidth < mobileNodeMinWidth;
      const largeScreenFitNodeWidth = (availableWidth - titleColumnWidth - titleGap - edgeGutter
        - Math.max(0, widestPromoRow - 1) * columnGap) / widestPromoRow;
      const largeScreenNodeWidth = Math.max(1, Math.min(230, largeScreenFitNodeWidth));
      const nodeSlotWidth = mobileSolution
        ? horizontalScroll ? mobileNodeMaxWidth : Math.min(mobileNodeMaxWidth, mobileFitNodeWidth)
        : compactSolution ? 150 : compact ? 112 : largeScreen ? largeScreenNodeWidth : 238;
      const largeScreenLevelCount = Math.max(1, groups.length);
      const largeScreenLevelPadding = 6;
      const largeScreenTargetGap = Math.min(18, Math.max(4, availableHeight * 0.035));
      const largeScreenVerticalRoom = Math.max(
        0,
        availableHeight - 4 - largeScreenLevelCount * largeScreenLevelPadding * 2
      );
      const largeScreenMinNodeHeight = 36;
      const largeScreenMaxGap = largeScreenLevelCount > 1
        ? Math.max(0, (largeScreenVerticalRoom - largeScreenLevelCount * largeScreenMinNodeHeight) / (largeScreenLevelCount - 1))
        : largeScreenTargetGap;
      const largeScreenLevelGap = Math.min(largeScreenTargetGap, largeScreenMaxGap);
      const largeScreenNodeHeight = Math.max(
        largeScreenMinNodeHeight,
        Math.min(
          52,
          (largeScreenVerticalRoom - Math.max(0, largeScreenLevelCount - 1) * largeScreenLevelGap) / largeScreenLevelCount
        )
      );
      const largeScreenTextScale = Math.max(0.78, Math.min(1, largeScreenNodeHeight / 52));
      plane.style.setProperty('--game-node-width', `${nodeSlotWidth}px`);
      plane.style.setProperty('--game-node-height', `${largeScreen ? largeScreenNodeHeight : 82}px`);
      plane.style.setProperty('--game-level-gap', `${largeScreenLevelGap}px`);
      plane.style.setProperty('--game-level-padding', `${largeScreenLevelPadding}px`);
      plane.style.setProperty('--game-level-center-offset', `${largeScreen ? largeScreenLevelGap / 2 : 0}px`);
      plane.style.setProperty('--game-empty-level-height', `${largeScreen ? largeScreenNodeHeight : 56}px`);
      plane.style.setProperty('--game-node-text-scale', `${largeScreenTextScale}`);
      const nodeAreaWidth = widestPromoRow * nodeSlotWidth
        + Math.max(0, widestPromoRow - 1) * columnGap
        + edgeGutter;
      const planeWidth = Math.max(availableWidth, titleColumnWidth + titleGap + nodeAreaWidth);
      const width = Math.max(1, mobileSolution ? availableWidth : plane.offsetWidth, planeWidth);
      const height = Math.max(1, plane.offsetHeight);
      const scale = mobileSolution || largeScreen ? 1 : Math.min(1, availableWidth / width, availableHeight / height);
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

    graphUpdateRef.current = update;
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
      graphUpdateRef.current = null;
    };
  }, [graph.edges, graph.byId, visibleIds, renderedIds, groups, shortestEdgeKeys, possibleIds, widestPromoRow, solutionLayout, forbiddenId, startId, endId]);

  useLayoutEffect(() => {
    if (!elasticDrag) return undefined;
    const plane = planeRef.current;
    const planeRect = plane?.getBoundingClientRect();
    const scale = Math.max(0.01, layout.scale);
    if (!planeRect?.width || !planeRect.height) return undefined;

    elasticScaleRef.current = scale;
    const simulationNodes = renderedNodes.flatMap((student) => {
      const element = nodeRefs.current.get(student.id);
      const rect = element?.getBoundingClientRect();
      if (!rect) return [];
      const previousOffset = nodeOffsetsRef.current[student.id] ?? { x: 0, y: 0 };
      const x = (rect.left + rect.width / 2 - planeRect.left) / scale - previousOffset.x;
      const y = (rect.top + rect.height / 2 - planeRect.top) / scale - previousOffset.y;
      return [{
        id: student.id,
        baseX: x,
        baseY: y,
        x: x + previousOffset.x,
        y: y + previousOffset.y,
        width: rect.width / scale,
        height: rect.height / scale,
        promo: student.promo,
      }];
    });
    if (!simulationNodes.length) return undefined;

    const nodesById = new Map(simulationNodes.map((node) => [node.id, node]));
    const simulationLinks = graph.edges.flatMap((edge) => {
      const source = nodesById.get(endpointId(edge.source));
      const target = nodesById.get(endpointId(edge.target));
      if (!source || !target) return [];
      return [{
        source: source.id,
        target: target.id,
        restLength: Math.hypot(target.baseX - source.baseX, target.baseY - source.baseY),
      }];
    });
    const simulation = forceSimulation(simulationNodes)
      .stop()
      .alpha(0)
      .velocityDecay(0.24)
      .alphaDecay(0.07)
      .force('link', forceLink(simulationLinks)
        .id((node) => node.id)
        .distance((link) => link.restLength)
        .strength(0.14))
      .force('charge', forceManyBody().strength(-52).distanceMax(Math.max(180, layout.width / scale)))
      .force('x', forceX((node) => node.baseX).strength(0.008))
      .force('y', forceY((node) => node.baseY).strength(0.12))
      .force('collision', forceNodeCollision(6));

    const restoreNodesToOrigin = () => {
      if (dragRef.current || returnFrameRef.current) return;
      simulation.stop();
      const startingPositions = simulationNodes.map((node) => ({
        node,
        x: node.x,
        y: node.y,
      }));
      const startedAt = performance.now();
      const duration = 900;
      const animateHome = (now) => {
        if (dragRef.current || elasticSimulationRef.current !== simulation) {
          returnFrameRef.current = 0;
          return;
        }
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress * progress * (3 - (2 * progress));
        startingPositions.forEach(({ node, x, y }) => {
          node.x = x + (node.baseX - x) * eased;
          node.y = y + (node.baseY - y) * eased;
          node.vx = 0;
          node.vy = 0;
        });
        separateOverlappingNodes(simulationNodes, 6);
        if (progress >= 1) {
          startingPositions.forEach(({ node }) => {
            node.x = node.baseX;
            node.y = node.baseY;
          });
          returnFrameRef.current = 0;
          saveNodeOffsets({});
          return;
        }
        saveNodeOffsets(Object.fromEntries(simulationNodes.map((node) => [node.id, {
          x: node.x - node.baseX,
          y: node.y - node.baseY,
        }])));
        returnFrameRef.current = window.requestAnimationFrame(animateHome);
      };
      returnFrameRef.current = window.requestAnimationFrame(animateHome);
    };

    simulation.on('tick', () => {
      const activeDrag = dragRef.current;
      if (activeDrag) {
        const activeNode = nodesById.get(activeDrag.nodeId);
        if (activeNode && activeDrag.targetX != null && activeDrag.targetY != null) {
          activeDrag.targetX = keepPromoNodesApart(activeNode, activeDrag.targetX);
          activeNode.fx = activeDrag.targetX;
          activeNode.fy = activeDrag.targetY;
          activeNode.x = activeDrag.targetX;
          activeNode.y = activeDrag.targetY;
        }
      }
      const verticalLimit = 20 / scale;
      simulationNodes.forEach((node) => {
        const minY = node.baseY - verticalLimit;
        const maxY = node.baseY + verticalLimit;
        if (node.y < minY) {
          node.y = minY;
          if (node.vy < 0) node.vy *= -0.32;
        } else if (node.y > maxY) {
          node.y = maxY;
          if (node.vy > 0) node.vy *= -0.32;
        }
      });
      separateOverlappingNodes(simulationNodes, 6);
      const offsets = Object.fromEntries(simulationNodes.map((node) => [node.id, {
        x: node.x - node.baseX,
        y: node.y - node.baseY,
      }]));
      saveNodeOffsets(offsets);
    });
    simulation.on('end', restoreNodesToOrigin);
    elasticNodesRef.current = nodesById;
    elasticSimulationRef.current = simulation;
    return () => {
      window.cancelAnimationFrame(returnFrameRef.current);
      returnFrameRef.current = 0;
      simulation.stop();
      simulation.on('tick', null);
      simulation.on('end', null);
      if (elasticSimulationRef.current === simulation) {
        elasticSimulationRef.current = null;
        elasticNodesRef.current = new Map();
      }
    };
  }, [elasticDrag, graph.edges, layout.height, layout.scale, layout.width, renderedNodes]);

  useLayoutEffect(() => {
    if (elasticDrag) graphUpdateRef.current?.();
  }, [elasticDrag, nodeOffsets]);

  return (
    <>
      <div
        ref={viewportRef}
        className={'game-graph__viewport'
          + (solutionLayout ? ' game-graph__viewport--solution' : '')
          + (weeklyMode ? ' game-graph__viewport--weekly' : '')
          + (practiceMode ? ' game-graph__viewport--practice' : '')
          + (elasticDrag ? ' game-graph__viewport--elastic' : '')
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
                            + (elasticDrag && draggingNodeId === student.id ? ' game-node--being-dragged' : '')
                            + (displayedName.length >= 26 ? ' game-node--very-long-name'
                              : displayedName.length >= 18 ? ' game-node--long-name' : '')}
                          style={elasticDrag
                            ? {
                              transform: `translate3d(${nodeOffsets[student.id]?.x ?? 0}px, ${nodeOffsets[student.id]?.y ?? 0}px, 0)`,
                            }
                            : undefined}
                          role={elasticDrag ? 'group' : undefined}
                          tabIndex={elasticDrag ? 0 : undefined}
                          aria-roledescription={elasticDrag ? 'nœud déplaçable dans le graphe' : undefined}
                          aria-label={elasticDrag
                            ? student.name + ', déplacer dans le graphe avec les flèches'
                            : isHinted
                              ? 'Indice : ' + getStudentInitials(student.name)
                              : isForbidden ? student.name + ', interdit par la règle hebdomadaire'
                                : isRequired ? student.name + ', passage obligatoire' : undefined}
                          onPointerDown={elasticDrag ? (event) => handleElasticPointerDown(event, student.id) : undefined}
                          onPointerMove={elasticDrag ? handleElasticPointerMove : undefined}
                          onPointerUp={elasticDrag ? handleElasticPointerEnd : undefined}
                          onPointerCancel={elasticDrag ? handleElasticPointerEnd : undefined}
                          onLostPointerCapture={elasticDrag ? handleElasticPointerEnd : undefined}
                          onKeyDown={elasticDrag ? (event) => handleElasticKeyDown(event, student.id) : undefined}
                          onKeyUp={elasticDrag ? handleElasticKeyUp : undefined}
                          onBlur={elasticDrag ? () => {
                            if (dragRef.current?.pointerId === null) finishElasticDrag();
                          } : undefined}
                        >
                          {stepIndex > 0 && <span className="game-node__step" aria-hidden="true">{stepIndex}</span>}
                          <ShapeSwatch promo={student.promo} size={layout.nodeWidth >= 250 ? 22 : 20} />
                          <span className="game-node__copy">
                            <strong
                              style={solutionLayout
                                ? mobileSolutionLayout
                                  ? {
                                    '--mobile-game-node-name-size': `${Math.max(
                                      6,
                                      Math.min(10.5, ((layout.nodeWidth - 48) * 1.75) / Math.max(1, displayedName.length))
                                    )}px`,
                                  }
                                  : { fontSize: `${getSolutionNodeNameFontSize(displayedName, layout.nodeWidth, stepIndex > 0)}px` }
                                : largeScreenLayout
                                  ? { fontSize: `${getSolutionNodeNameFontSize(displayedName, layout.nodeWidth, stepIndex > 0)}px` }
                                  : undefined}
                            >
                              {displayedName}
                            </strong>
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
