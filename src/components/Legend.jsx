import { useEffect, useRef, useState } from 'react';
import BrandDivider from './BrandDivider';
import ShapeSwatch from './ShapeSwatch';
import { describePromo } from '../lib/promo';

// Remplissage par colonnes : 3 lignes jusqu'à 9 promos, puis 4 lignes jusqu'à 16, puis 5 jusqu'à 25...
const rowsFor = (count) => Math.max(3, Math.ceil(Math.sqrt(count)));

export default function Legend({ promos, visible, onToggle }) {
  const [mounted, setMounted] = useState(visible);
  const [opening, setOpening] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef(null);
  const closeTimer = useRef(null);
  const openFrame = useRef(null);

  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    window.cancelAnimationFrame(openFrame.current);

    if (visible) {
      if (!mounted) {
        setMounted(true);
        setOpening(true);
        openFrame.current = window.requestAnimationFrame(() => setOpening(false));
      } else {
        setOpening(false);
      }
    } else {
      setOpening(false);
      const closeDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 440;
      closeTimer.current = window.setTimeout(() => setMounted(false), closeDelay);
    }

    return () => {
      window.clearTimeout(closeTimer.current);
      window.cancelAnimationFrame(openFrame.current);
    };
  }, [visible]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!mounted || !panel) return undefined;

    // offsetHeight reports the layout size, without the scale used by the
    // opening/closing animation. getBoundingClientRect() can read the shrunken
    // size during a quick reopen and leave the disclosure stuck too short.
    const updateHeight = () => setPanelHeight(panel.offsetHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) {
    return (
      <button type="button" className="btn btn--ghost legend-disclosure__standalone" onClick={onToggle}>
        Afficher la légende
      </button>
    );
  }

  const recentFirst = [...promos].sort((a, b) => b - a);
  const compact = !visible || opening;

  return (
    <div
      className={`legend-disclosure${!visible ? ' legend-disclosure--closing' : opening ? ' legend-disclosure--opening' : ''}`}
      style={{ height: compact ? 'var(--legend-button-height)' : panelHeight ? `${panelHeight}px` : undefined }}
    >
      <section ref={panelRef} className="legend" aria-label="Légende des promotions" aria-hidden={!visible}>
        <header className="legend__header">
          <h2 className="legend__title">Promotions</h2>
          <button type="button" className="legend__toggle" onClick={onToggle} disabled={!visible}>
            Masquer
          </button>
        </header>
        <ul className="legend__list" style={{ '--rows': rowsFor(recentFirst.length) }}>
          {recentFirst.map((promo) => {
            const { label, detail } = describePromo(promo);
            return (
              <li key={promo} className="legend__item">
                <ShapeSwatch promo={promo} size={18} />
                <span className="legend__label">{label}</span>
                <BrandDivider />
                <span className="legend__detail">{detail}</span>
              </li>
            );
          })}
        </ul>
      </section>
      {(!visible || opening) && (
        <button type="button" className="legend-disclosure__target btn btn--ghost" onClick={onToggle}>
          Afficher la légende
        </button>
      )}
    </div>
  );
}
