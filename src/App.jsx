import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GraphView from './components/GraphView';
import Legend from './components/Legend';
import StudentCard from './components/StudentCard';
import StudentSearch from './components/StudentSearch';
import AdminPanel from './components/AdminPanel';
import GamePage from './GamePage';
import { loadData } from './lib/loadData';
import { getLineage, prepareGraph } from './lib/lineage';

export default function App() {
  const isAdminPage = window.location.pathname.replace(/\/+$/, '').endsWith('/admin');
  const [loaded, setLoaded] = useState(null);
  const [showGame, setShowGame] = useState(() => window.location.hash.startsWith('#jeu'));
  const [selectedId, setSelectedId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteStudentRequest, setDeleteStudentRequest] = useState(null);
  const [quickAddRequest, setQuickAddRequest] = useState(null);
  const [showLegend, setShowLegend] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches
  );
  const [showWarnings, setShowWarnings] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const quickAddSequence = useRef(0);
  const deleteStudentSequence = useRef(0);
  const contactInfoRef = useRef(null);
  const contactInfoButtonRef = useRef(null);
  const contactInfoModalRef = useRef(null);
  const contactInfoStartX = useRef(null);
  const dockActionsRef = useRef(null);
  const dockActionsRect = useRef(null);
  const dockActionsAnimation = useRef(null);

  useEffect(() => {
    const syncPage = () => setShowGame(window.location.hash.startsWith('#jeu'));
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return undefined;

    const updateKeyboardInset = () => {
      const obscuredHeight = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
      const keyboardInset = obscuredHeight > 120 ? obscuredHeight : 0;
      document.documentElement.style.setProperty('--keyboard-inset', keyboardInset + 'px');
    };

    updateKeyboardInset();
    visualViewport.addEventListener('resize', updateKeyboardInset);
    visualViewport.addEventListener('scroll', updateKeyboardInset);
    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardInset);
      visualViewport.removeEventListener('scroll', updateKeyboardInset);
      document.documentElement.style.removeProperty('--keyboard-inset');
    };
  }, []);

  useEffect(() => {
    if (!showContactInfo) return undefined;

    contactInfoModalRef.current?.focus();
    const handleModalKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowContactInfo(false);
        contactInfoButtonRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        contactInfoModalRef.current?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!contactInfoModalRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleModalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleModalKeyDown);
    };
  }, [showContactInfo]);

  useEffect(() => {
    let cancelled = false;
    loadData().then((result) => {
      if (!cancelled) setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event) => {
      const isDeleteKey = ['Delete', 'Del', 'Backspace'].includes(event.key)
        || ['Delete', 'Backspace'].includes(event.code);
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !isDeleteKey || !isAdmin || !selectedId) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;

      event.preventDefault();
      deleteStudentSequence.current += 1;
      setDeleteStudentRequest({ id: deleteStudentSequence.current, studentId: selectedId });
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isAdmin, selectedId]);

  // Calculé une seule fois par jeu de données : react-force-graph mute les objets qu'on lui passe
  const graph = useMemo(() => (loaded ? prepareGraph(loaded.data) : null), [loaded]);

  useLayoutEffect(() => {
    const actions = dockActionsRef.current;
    if (!actions) {
      contactInfoStartX.current = null;
      dockActionsRect.current = null;
      return;
    }

    if (dockActionsAnimation.current) {
      cancelAnimationFrame(dockActionsAnimation.current);
      dockActionsAnimation.current = null;
      actions.style.transition = '';
      actions.style.transform = '';
    }

    const nextRect = actions.getBoundingClientRect();
    const previousTop = dockActionsRect.current;
    dockActionsRect.current = nextRect.top;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const info = contactInfoRef.current;
    let animateInfo = false;
    const startX = contactInfoStartX.current;
    contactInfoStartX.current = null;

    if (info) {
      const actionsLeft = actions.getBoundingClientRect().left;
      const globalButton = actions.querySelector('.global-view-control');
      const closedLegendButton = actions.parentElement?.querySelector(
        '.legend-disclosure__target, .legend-disclosure__standalone'
      );
      const targetX = showLegend
        ? (globalButton?.getBoundingClientRect().right ?? actionsLeft + 96) + 8
        : (closedLegendButton?.getBoundingClientRect().right ?? actionsLeft + 96) - info.getBoundingClientRect().width;

      info.style.transition = 'none';
      info.style.transform = '';
      info.style.left = `${targetX - actionsLeft}px`;
      const dx = startX === null ? 0 : startX - info.getBoundingClientRect().left;
      if (startX !== null && !reduceMotion && Math.abs(dx) >= 1) {
        info.style.transform = `translate(${dx}px, -50%)`;
        info.getBoundingClientRect();
        animateInfo = true;
      } else {
        info.style.transition = '';
      }
    }

    const dy = previousTop - nextRect.top;
    const animateRow = previousTop !== null && !reduceMotion && Math.abs(dy) >= 1;

    if (animateRow) {
      actions.style.transition = 'none';
      actions.style.transform = `translateY(${dy}px)`;
    }

    if (animateRow || animateInfo) {
      actions.getBoundingClientRect();
      dockActionsAnimation.current = requestAnimationFrame(() => {
        if (animateRow) {
          actions.style.transition = '';
          actions.style.transform = '';
        }
        if (animateInfo && info) {
          info.style.transition = '';
          info.style.transform = '';
        }
        dockActionsAnimation.current = null;
      });
    }
  }, [graph, showGame, showLegend]);

  const lineage = useMemo(
    () => (graph && selectedId ? getLineage(graph.index, selectedId) : null),
    [graph, selectedId]
  );
  const toggleLegend = () => {
    const rect = dockActionsRef.current?.getBoundingClientRect();
    if (rect) dockActionsRect.current = rect.top;
    const infoRect = contactInfoRef.current?.getBoundingClientRect();
    if (infoRect) contactInfoStartX.current = infoRect.left;
    setShowLegend((visible) => !visible);
  };
  const closeContactInfo = () => {
    setShowContactInfo(false);
    contactInfoButtonRef.current?.focus();
  };
  const closeCardFromMobileSearch = () => {
    if (selectedId && window.matchMedia('(max-width: 767px)').matches) {
      setSelectedId(null);
      return true;
    }
    return false;
  };

  if (!graph) {
    return (
      <div className="app">
        <p className="loading">Chargement du réseau…</p>
      </div>
    );
  }

  if (showGame) return <GamePage students={loaded.data.nodes} links={loaded.data.links} />;

  const { index, promos, graphData } = graph;
  const student = selectedId ? index.byId.get(selectedId) : null;
  const resolve = (ids) => (ids ?? []).map((id) => index.byId.get(id));
  const warnings = loaded.warnings;

  return (
    <div className={`app${student ? ' app--card-open' : ''}${isAdmin ? ' app--admin' : ''}`}>
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
          Cliquez sur un étudiant pour voir sa lignée.
        </p>
        <StudentSearch
          students={loaded.data.nodes}
          onSelect={setSelectedId}
          onActivate={closeCardFromMobileSearch}
        />
      </header>

      <div className="controls">
        <div className={`dock${showLegend ? ' dock--legend-open' : ''}`}>
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
          <div
            ref={dockActionsRef}
            className="dock__actions"
          >
            <button
              type="button"
              className="btn btn--ghost global-view-control"
              onClick={() => {
                setSelectedId(null);
                setResetTick((t) => t + 1);
              }}
            >
              Vue globale
            </button>
            <div className="contact-info" ref={contactInfoRef}>
              <button
                type="button"
                ref={contactInfoButtonRef}
                className="contact-info__button"
                aria-label={showContactInfo ? 'Fermer les informations' : 'Afficher les informations'}
                aria-expanded={showContactInfo}
                aria-controls="contact-info-panel"
                onClick={() => setShowContactInfo((visible) => !visible)}
              >
                <span aria-hidden="true">i</span>
              </button>
            </div>
          </div>
          <Legend promos={promos} visible={showLegend} onToggle={toggleLegend} />
        </div>

        <div className="controls__actions">
          <a className="btn btn--ghost game-launch" href="#jeu">Jouer</a>
          {isAdminPage && (
            <AdminPanel
              data={loaded.data}
              initialSelectedId={selectedId}
              deleteRequest={deleteStudentRequest}
              onDeleteHandled={(requestId) => {
                setDeleteStudentRequest((request) => request?.id === requestId ? null : request);
              }}
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
          )}
        </div>
      </div>

      {showContactInfo && (
        <div
          className="contact-info__overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeContactInfo();
          }}
        >
          <section
            ref={contactInfoModalRef}
            className="contact-info__modal"
            id="contact-info-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-info-title"
            tabIndex={-1}
          >
            <h2 id="contact-info-title">
              <span className="contact-info__title-desktop">Vous avez repéré un problème&nbsp;?</span>
              <span className="contact-info__title-mobile">Une erreur&nbsp;?</span>
            </h2>
            <p>Un lien manque ou vous avez repéré une autre erreur&nbsp;? Vous pouvez contacter le BDE.</p>
          </section>
        </div>
      )}

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
