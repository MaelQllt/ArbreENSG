import { useEffect, useMemo, useRef, useState } from 'react';
import GraphView from './components/GraphView';
import Legend from './components/Legend';
import StudentCard from './components/StudentCard';
import StudentSearch from './components/StudentSearch';
import AdminPanel from './components/AdminPanel';
import { loadData } from './lib/loadData';
import { getLineage, prepareGraph } from './lib/lineage';

export default function App() {
  const [loaded, setLoaded] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [quickAddRequest, setQuickAddRequest] = useState(null);
  const [showLegend, setShowLegend] = useState(true);
  const [showWarnings, setShowWarnings] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const quickAddSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadData().then((result) => {
      if (!cancelled) setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Calculé une seule fois par jeu de données : react-force-graph mute les objets qu'on lui passe
  const graph = useMemo(() => (loaded ? prepareGraph(loaded.data) : null), [loaded]);
  const lineage = useMemo(
    () => (graph && selectedId ? getLineage(graph.index, selectedId) : null),
    [graph, selectedId]
  );

  if (!graph) {
    return (
      <div className="app">
        <p className="loading">Chargement du réseau…</p>
      </div>
    );
  }

  const { index, promos, graphData } = graph;
  const student = selectedId ? index.byId.get(selectedId) : null;
  const resolve = (ids) => (ids ?? []).map((id) => index.byId.get(id));
  const warnings = loaded.warnings;

  return (
    <div className={`app${student ? ' app--card-open' : ''}`}>
      <GraphView
        graphData={graphData}
        selectedId={selectedId}
        lineage={lineage}
        onSelect={setSelectedId}
        isAdmin={isAdmin}
        onQuickAdd={(anchorId, relatedId) => {
          quickAddSequence.current += 1;
          setQuickAddRequest({ id: quickAddSequence.current, anchorId, relatedId });
        }}
        resetTick={resetTick}
      />

      <header className="masthead">
        <h1 className="masthead__title">
          <span className="masthead__light">Les familles de</span>
          <span className="masthead__bold">Géodata Paris</span>
        </h1>
        <p className="masthead__hint">
          {loaded.source === 'mock'
            ? "Données d'exemple : ajoutez public/students.csv pour afficher vos étudiants."
            : 'Cliquez sur un étudiant pour révéler sa lignée.'}
        </p>
        <StudentSearch students={loaded.data.nodes} onSelect={setSelectedId} />
      </header>

      <div className="controls">
        <div className="dock">
          {warnings.length > 0 && (
            <div className="notice">
              <button type="button" className="notice__toggle" onClick={() => setShowWarnings((v) => !v)}>
                {warnings.length} point(s) à vérifier dans les données {showWarnings ? '(masquer)' : '(voir)'}
              </button>
              {showWarnings && (
                <ul className="notice__list">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setSelectedId(null);
              setResetTick((t) => t + 1);
            }}
          >
            Vue globale
          </button>
          <Legend promos={promos} visible={showLegend} onToggle={() => setShowLegend((v) => !v)} />
        </div>

        <AdminPanel
          data={loaded.data}
          initialSelectedId={selectedId}
          quickAddRequest={quickAddRequest}
          onQuickAddHandled={(requestId) => {
            setQuickAddRequest((request) => request?.id === requestId ? null : request);
          }}
          onAdminStatus={setIsAdmin}
          onSaved={(data, warnings) => {
            setLoaded((current) => ({ ...current, data, warnings, source: 'shared' }));
            setSelectedId(null);
            setResetTick((tick) => tick + 1);
          }}
        />
      </div>

      <StudentCard
        student={student}
        parrains={student ? resolve(index.parents.get(student.id)) : []}
        fillots={student ? resolve(index.children.get(student.id)) : []}
        lineage={lineage}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(null)}
      />

    </div>
  );
}
