import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide, forceX, forceY } from 'd3-force';
import { COLORS, promoStyle, shapePolygon } from '../theme';
import { isLinkInLineage } from '../lib/lineage';
import TopoBackground from './TopoBackground';

const NODE_R = 5;
const MOBILE_NODE_R = 6.5;
const PANEL_WIDTH = 380;  // doit rester synchrone avec --panel-width en CSS

// Le noeud sélectionné grossit et reçoit un contour de la forme de sa promo.
const SELECTED_SCALE = 1.5; // le noeud sélectionné grossit

// Zoom
const MIN_ZOOM = 0.35;
const MOBILE_MIN_ZOOM = 0.18;
const MAX_ZOOM = 6;
const MAX_FIT_ZOOM = 3.5;

// Mise en place ordonnée, puis rappel doux : les étudiants restent libres sur les deux axes.
const ROW_PULL_LAYOUT = 0.3;
const ROW_PULL_FREE = 0.24;
const X_PULL_LAYOUT = 0.04;
const X_PULL_FREE = 0.005;
const VELOCITY_DECAY = 0.28; // défaut d3 : 0.4 (plus bas = plus de rebond)

// Étiquettes
const LABEL_FONT = 11;     // taille à l'écran, en px
const LABEL_MIN_ZOOM = 0.8; // en dessous, seulement le noeud survolé / sélectionné
const LABEL_MAX = 90;      // plafond d'étiquettes affichées en même temps
const LABEL_ALL_ZOOM = 1.6; // à ce niveau, on tente d'afficher tous les noms

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function tracePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  shapePolygon(shape, x, y, r).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

// Contour de la forme sélectionnée, dessiné sous le noeud pour laisser son remplissage visible.
function drawSelection(ctx, node, shape, color, r) {
  const accent = color === COLORS.violet ? COLORS.sand : color; // le violet se perd sur le bleu
  const { x, y } = node;

  tracePath(ctx, shape, x, y, r + 4.5);
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();
}

export default function GraphView({ graphData, selectedId, lineage, onSelect, isAdmin, onQuickAdd, resetTick }) {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const hasFitted = useRef(false);
  const previousGraphData = useRef(null);
  const rowForce = useRef(null);
  const colForce = useRef(null);
  const dragBounceFrames = useRef(new Map());
  const hoveredId = useRef(null);
  const labelWidths = useRef(new Map());
  const size = useElementSize(containerRef);
  const ready = size.width > 0 && size.height > 0;
  const nodeRadius = size.width <= 720 ? MOBILE_NODE_R : NODE_R;
  const minZoom = size.width <= 720 ? MOBILE_MIN_ZOOM : MIN_ZOOM;

  // react-force-graph ajoute x/y/vx/vy aux nœuds. Réutiliser ces coordonnées
  // lors d'un changement de lien évite de relancer tout le réseau à zéro.
  useLayoutEffect(() => {
    dragBounceFrames.current.forEach(({ frame, targetX, targetY }, node) => {
      cancelAnimationFrame(frame);
      node.x = node.fx = targetX;
      node.y = node.fy = targetY;
    });
    dragBounceFrames.current.clear();
    const previous = previousGraphData.current;
    if (previous && previous !== graphData) {
      const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
      graphData.nodes.forEach((node) => {
        const oldNode = previousNodes.get(node.id);
        if (!oldNode || !Number.isFinite(oldNode.x) || !Number.isFinite(oldNode.y)) return;
        node.x = oldNode.x;
        node.y = oldNode.y;
        node.vx = oldNode.vx ?? 0;
        node.vy = oldNode.vy ?? 0;
        if (Number.isFinite(oldNode.fx)) node.fx = oldNode.fx;
        if (Number.isFinite(oldNode.fy)) node.fy = oldNode.fy;
      });
    }
    previousGraphData.current = graphData;
  }, [graphData]);

  const nodeById = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, n])), [graphData]);
  // les noeuds les plus connectés passent en premier pour obtenir leur étiquette
  const labelOrder = useMemo(() => [...graphData.nodes].sort((a, b) => b.degree - a.degree), [graphData]);

  // Forces : chaque promo attire ses étudiants vers sa bande, sans les y bloquer.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const pullStrength = hasFitted.current
      ? { row: ROW_PULL_FREE, x: X_PULL_FREE }
      : { row: ROW_PULL_LAYOUT, x: X_PULL_LAYOUT };
    rowForce.current = forceY((node) => node.promoY).strength(pullStrength.row);
    colForce.current = forceX(0).strength(pullStrength.x);
    fg.d3Force('y', rowForce.current);
    fg.d3Force('x', colForce.current);
    fg.d3Force('charge').strength(-95);
    fg.d3Force('link').distance(56).strength(0.08);
    fg.d3Force('collide', forceCollide(nodeRadius + 7));
    // Attendre que react-force-graph ait appliqué son nouveau graphData.
    const frame = requestAnimationFrame(() => fgRef.current?.d3ReheatSimulation());
    return () => cancelAnimationFrame(frame);
  }, [graphData, nodeRadius, ready]);

  // Cadre un ensemble de noeuds dans la zone libre (la fiche latérale est prise en compte)
  const fitTo = useCallback(
    (filter, withPanel) => {
      const fg = fgRef.current;
      const box = fg?.getGraphBbox(filter);
      if (!box) return;
      const { width: W, height: H } = size;
      const pad = { l: W < 720 ? 94 : 130, r: 70, t: 90, b: 70 };
      if (withPanel) {
        if (W < 720) pad.b += H * 0.5;
        else pad.r += PANEL_WIDTH;
      }
      const k = Math.max(
        minZoom,
        Math.min(
          (W - pad.l - pad.r) / Math.max(box.x[1] - box.x[0], 1),
          (H - pad.t - pad.b) / Math.max(box.y[1] - box.y[0], 1),
          MAX_FIT_ZOOM
        )
      );
      const cx = (box.x[0] + box.x[1]) / 2 + (pad.r - pad.l) / (2 * k);
      const cy = (box.y[0] + box.y[1]) / 2 + (pad.b - pad.t) / (2 * k);
      fg.centerAt(cx, cy, 700);
      fg.zoom(k, 700);
    },
    [minZoom, size]
  );

  // Au clic : on cadre la lignée entière
  useEffect(() => {
    if (lineage) fitTo((n) => lineage.nodeIds.has(n.id), true);
  }, [lineage, fitTo]);

  // Bouton "Vue globale" (piloté par App)
  const fitRef = useRef(fitTo);
  fitRef.current = fitTo;
  useEffect(() => {
    if (!resetTick) return undefined;
    let nextFrame;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => fitRef.current(undefined, false));
    });
    return () => {
      cancelAnimationFrame(frame);
      if (nextFrame) cancelAnimationFrame(nextFrame);
    };
  }, [resetTick]);

  const paintNode = useCallback(
    (node, ctx) => {
      const active = !lineage || lineage.nodeIds.has(node.id);
      const selected = node.id === selectedId;
      const { color, shape, stroke } = promoStyle(node.promo);
      const r = selected ? nodeRadius * SELECTED_SCALE : nodeRadius;

      ctx.globalAlpha = active ? 1 : 0.12;
      ctx.lineJoin = 'miter';

      if (selected) drawSelection(ctx, node, shape, color, r);

      tracePath(ctx, shape, node.x, node.y, r);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    [lineage, nodeRadius, selectedId]
  );

  const paintPointerArea = useCallback((node, color, ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(node.x - nodeRadius - 5, node.y - nodeRadius - 5, (nodeRadius + 5) * 2, (nodeRadius + 5) * 2);
  }, [nodeRadius]);

  // Étiquettes dessinées après les noeuds, avec anti-chevauchement :
  // un nom n'est affiché que s'il ne recouvre pas un nom déjà placé.
  const drawLabels = useCallback(
    (ctx, k) => {
      const showAll = !lineage && k >= LABEL_MIN_ZOOM;
      const highZoom = k >= LABEL_ALL_ZOOM;
      const labelLimit = highZoom ? labelOrder.length : LABEL_MAX;
      const placed = [];
      const done = new Set();

      const place = (node, force) => {
        if (!node || node.x == null || done.has(node.id)) return;
        done.add(node.id);

        let w = labelWidths.current.get(node.name);
        if (w == null) {
          ctx.font = `400 ${LABEL_FONT}px Roboto, sans-serif`;
          w = ctx.measureText(node.name).width;
          labelWidths.current.set(node.name, w);
        }
        const pad = 3 / k;
        const bw = w / k + pad * 2;
        const bh = (LABEL_FONT + 5) / k;
        const centeredX = node.x - bw / 2;
        const belowY = node.y + nodeRadius * 1.4 + 2 / k;

        let box = { x0: centeredX, y0: belowY };
        if (!force) {
          if (placed.length >= labelLimit) return;
          const aboveY = node.y - nodeRadius * 1.4 - bh - 2 / k;
          const candidates = highZoom
            ? [
                { x0: centeredX, y0: belowY },
                { x0: centeredX, y0: aboveY },
                { x0: node.x - nodeRadius - 4 / k - bw, y0: node.y - bh / 2 },
                { x0: node.x + nodeRadius + 4 / k, y0: node.y - bh / 2 },
                ...Array.from({ length: 6 }, (_, i) => ({
                  x0: centeredX,
                  y0: belowY + (i + 1) * (bh + 2 / k),
                })),
                ...Array.from({ length: 6 }, (_, i) => ({
                  x0: centeredX,
                  y0: aboveY - (i + 1) * (bh + 2 / k),
                })),
              ]
            : [box];
          box = candidates.find((candidate) =>
            !placed.some((b) =>
              candidate.x0 < b.x1 && candidate.x0 + bw > b.x0 && candidate.y0 < b.y1 && candidate.y0 + bh > b.y0
            )
          );
          if (!box) return;
        }
        const { x0, y0 } = box;
        placed.push({ x0, y0, x1: x0 + bw, y1: y0 + bh });

        ctx.fillStyle = 'rgba(43, 49, 127, 0.92)';
        ctx.fillRect(x0, y0, bw, bh);
        ctx.font = `${node.id === selectedId ? 700 : 400} ${LABEL_FONT / k}px Roboto, sans-serif`;
        ctx.fillStyle = COLORS.paper;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.name, x0 + bw / 2, y0 + bh / 2);
      };

      place(nodeById.get(hoveredId.current), true);
      place(nodeById.get(selectedId), true);
      for (const node of labelOrder) {
        if (lineage ? lineage.nodeIds.has(node.id) : showAll) place(node, false);
      }
    },
    [lineage, selectedId, labelOrder, nodeById, nodeRadius]
  );

  const inLineage = (link) => lineage && isLinkInLineage(link, lineage);

  return (
    <div className="stage" ref={containerRef}>
      <TopoBackground />
      {ready && (
        <ForceGraph2D
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          enablePanInteraction
          enableNodeDrag
          enableZoomInteraction
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={nodeRadius}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          nodeLabel={() => ''}
          onRenderFramePost={drawLabels}
          linkColor={(l) => {
            if (lineage) return inLineage(l) ? COLORS.yellow : 'rgba(255,255,255,0.035)';
            return 'rgba(255,255,255,0.06)';
          }}
          linkWidth={(l) => (inLineage(l) ? 2 : 0.45)}
          linkDirectionalParticles={(l) => (inLineage(l) ? 1 : 0)}
          linkDirectionalParticleWidth={5}
          linkDirectionalParticleSpeed={0.01}
          linkDirectionalParticleColor={() => COLORS.sand}
          onNodeClick={(node, event) => {
            if (isAdmin && event?.shiftKey && selectedId && node.id !== selectedId) {
              onQuickAdd(selectedId, node.id);
              return;
            }
            onSelect(node.id);
          }}
          onNodeDragStart={(node) => {
            const bounce = dragBounceFrames.current.get(node);
            if (bounce) cancelAnimationFrame(bounce.frame);
            dragBounceFrames.current.delete(node);
          }}
          onNodeDragEnd={(node, translate) => {
            // Un petit dépassement amorti donne du ressort au lâcher, puis le
            // nœud reste fixé à sa nouvelle place jusqu'au rechargement.
            const dx = translate?.x ?? 0;
            const dy = translate?.y ?? 0;
            const distance = Math.hypot(dx, dy);
            const targetX = node.x;
            const targetY = node.y;
            node.vx = 0;
            node.vy = 0;
            node.fx = node.x;
            node.fy = node.y;

            if (!distance) return;
            const amplitude = Math.min(7, Math.max(3, distance * 0.025));
            const startedAt = performance.now();
            const animate = (now) => {
              const progress = Math.min(1, (now - startedAt) / 480);
              const offset = progress < 1
                ? amplitude * Math.sin(progress * Math.PI * 2) * Math.exp(-3.4 * progress)
                : 0;
              const x = targetX + (dx / distance) * offset;
              const y = targetY + (dy / distance) * offset;
              node.x = node.fx = x;
              node.y = node.fy = y;

              if (progress < 1) {
                const frame = requestAnimationFrame(animate);
                dragBounceFrames.current.set(node, { frame, targetX, targetY });
              } else {
                dragBounceFrames.current.delete(node);
              }
            };
            const frame = requestAnimationFrame(animate);
            dragBounceFrames.current.set(node, { frame, targetX, targetY });
          }}
          onNodeHover={(node) => { hoveredId.current = node ? node.id : null; }}
          onBackgroundClick={() => onSelect(null)}
          minZoom={minZoom}
          maxZoom={MAX_ZOOM}
          d3VelocityDecay={VELOCITY_DECAY}
          // nécessaire : les accesseurs dépendent de l'état React, le canvas doit se redessiner
          autoPauseRedraw={false}
          warmupTicks={80}
          cooldownTicks={250}
          onEngineStop={() => {
            if (!hasFitted.current) {
              hasFitted.current = true;
              fitTo(undefined, false); // vue globale dézoomée à l'ouverture
            }
            rowForce.current?.strength(ROW_PULL_FREE);
            colForce.current?.strength(X_PULL_FREE);
          }}
        />
      )}
    </div>
  );
}
