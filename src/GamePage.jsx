import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import BrandDivider from './components/BrandDivider';
import ShapeSwatch from './components/ShapeSwatch';
import TopoBackground from './components/TopoBackground';
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

function GameGraph({ graph, nodes, startId, endId, shortestIds, possibleIds, ariaLabel = 'Graphe des personnes trouvées' }) {
  const canvasRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [layout, setLayout] = useState({ width: 0, height: 0, lines: [] });

  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const groups = useMemo(() => {
    const byPromo = new Map();
    nodes.forEach((node) => {
      if (!byPromo.has(node.promo)) byPromo.set(node.promo, []);
      byPromo.get(node.promo).push(node);
    });
    return [...byPromo.entries()]
      .sort(([a], [b]) => a - b)
      .map(([promo, members]) => [promo, members.sort((a, b) => a.name.localeCompare(b.name, 'fr'))]);
  }, [nodes]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const update = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const lines = graph.edges
        .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
        .map((edge) => {
          const sourceElement = nodeRefs.current.get(edge.source);
          const targetElement = nodeRefs.current.get(edge.target);
          if (!sourceElement || !targetElement) return null;
          const sourceRect = sourceElement.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const x1 = sourceRect.left + sourceRect.width / 2 - canvasRect.left;
          const y1 = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
          const x2 = targetRect.left + targetRect.width / 2 - canvasRect.left;
          const y2 = targetRect.top + targetRect.height / 2 - canvasRect.top;
          const curve = Math.min(90, Math.max(28, Math.abs(y2 - y1) * 0.38));
          const sign = y2 >= y1 ? 1 : -1;
          return {
            key: edge.source + '>' + edge.target,
            d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + curve * sign) + ', ' + x2 + ' ' + (y2 - curve * sign) + ', ' + x2 + ' ' + y2,
          };
        })
        .filter(Boolean);
      setLayout({ width: canvas.scrollWidth, height: canvas.scrollHeight, lines });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    nodeRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [graph.edges, visibleIds, groups]);

  return (
    <div className="game-graph__viewport" role="region" aria-label="Graphe des personnes trouvées">
      <div ref={canvasRef} className="game-graph__canvas">
        <svg
          className="game-graph__links"
          width={layout.width}
          height={layout.height}
          viewBox={'0 0 ' + layout.width + ' ' + layout.height}
          aria-hidden="true"
        >
          {layout.lines.map((line) => <path key={line.key} d={line.d} />)}
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
                <div className="game-graph__nodes">
                  {members.map((student) => {
                    const isStart = student.id === startId;
                    const isEnd = student.id === endId;
                    const isShortest = shortestIds.has(student.id);
                    const isOffPath = !possibleIds.has(student.id);
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
                        <ShapeSwatch promo={student.promo} size={20} />
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
  );
}

export default function GamePage({ students, links }) {
  const [mode, setMode] = useState('daily');
  const [round, setRound] = useState(0);
  const [practiceSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [foundIds, setFoundIds] = useState([]);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [activePanel, setActivePanel] = useState(null);
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
  const shortestGraph = useMemo(() => ({
    ...graph,
    edges: shortestPath.slice(1).map((target, index) => ({ source: shortestPath[index], target })),
  }), [graph, shortestPath]);
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
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    if (mode === 'practice') setRound((value) => value + 1);
  };

  const selectMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setFoundIds([]);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
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
          <div className="game-page__brand">
            <span>Les familles de</span>
            <strong>Géodata Paris</strong>
          </div>
          <a className="btn btn--ghost game-page__back" href="#" aria-label="Retour à l’arbre">
            <span aria-hidden="true">←</span> Retour à l’arbre
          </a>
        </header>

        <section className="game-hero">
          <p className="game-hero__eyebrow">Jeu de parrainage <BrandDivider /> {pairLabel}</p>
          <h1>ENSGdle</h1>
          <p>Retrouve une chaîne de parrains, marraines, fillots et fillottes entre ces deux étudiants.</p>
        </section>

        <nav className="game-modes" aria-label="Mode de jeu">
          <button type="button" className={mode === 'daily' ? 'is-active' : ''} onClick={() => selectMode('daily')}>Journalier</button>
          <button type="button" className={mode === 'weekly' ? 'is-active' : ''} onClick={() => selectMode('weekly')}>Hebdomadaire</button>
          <button type="button" className={mode === 'practice' ? 'is-active' : ''} onClick={() => selectMode('practice')}>Entraînement</button>
        </nav>

        {challenge && start && end ? (
          <div className="game-layout">
            <section className="game-challenge" aria-labelledby="game-challenge-title">
              <div className="game-challenge__heading">
                <div>
                  <p className="game-section-kicker">{pairLabel}</p>
                  <h2 id="game-challenge-title">Qui relie ces deux étudiants&nbsp;?</h2>
                </div>
                <p className="game-attempt-count">{foundIds.length} étudiant{foundIds.length === 1 ? '' : 's'} ajouté{foundIds.length === 1 ? '' : 's'}</p>
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

              <form className="game-search" onSubmit={handleSubmit}>
                <label htmlFor="game-student-search">Choisis un étudiant dans toute la base</label>
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
                  : feedback || 'Tu peux choisir parmi tous les étudiants ; les liens montrent lesquels rejoignent la chaîne.'}
              </div>

              <div className="game-round-actions">
                <button type="button" className="btn btn--ghost" onClick={clearRound}>
                  {mode === 'practice' ? 'Nouvelle partie' : 'Rejouer le défi'}
                </button>
                <div className="game-round-actions__links">
                  <button
                    type="button"
                    className="game-help-link game-help-link--button"
                    ref={solutionButtonRef}
                    onClick={() => setActivePanel('solution')}
                    aria-haspopup="dialog"
                  >
                    Voir le chemin optimal
                  </button>
                  <button
                    ref={helpButtonRef}
                    type="button"
                    className="game-help-link game-help-link--button"
                    onClick={() => setActivePanel('help')}
                    aria-haspopup="dialog"
                  >
                    Comment jouer&nbsp;?
                  </button>
                </div>
              </div>

            </section>

            <section className="game-graph" aria-labelledby="game-graph-title">
              <header className="game-graph__header">
                <div>
                  <p className="game-section-kicker">Ton arbre se construit au fil des réponses</p>
                  <h2 id="game-graph-title">Connexions trouvées</h2>
                </div>
                <span className="game-graph__legend">
                  <span className="game-graph__legend-item"><i /> Chemin le plus court</span>
                  <span className="game-graph__legend-item"><i className="game-graph__legend-off-path" /> Hors chemin possible</span>
                </span>
              </header>
              <GameGraph
                graph={graph}
                nodes={shownNodes}
                startId={startId}
                endId={endId}
                shortestIds={shortestIds}
                possibleIds={possibleIds}
              />
            </section>
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
                  <GameGraph
                    graph={shortestGraph}
                    nodes={shortestNodes}
                    startId={startId}
                    endId={endId}
                    shortestIds={shortestIds}
                    possibleIds={new Set(shortestPath)}
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
