import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { describePromo } from '../lib/promo';
import { normalizeStudentSearch, searchStudentsByName } from '../lib/studentSearch';
import { promoStyle } from '../theme';
import BrandDivider from './BrandDivider';
import NameMatch from './NameMatch';

const KIND_LABELS = {
  parrain: 'parrain/marraine de',
  fillot: 'fillot/fillotte de',
};

function PromoLabel({ promo }) {
  const { level, label } = describePromo(promo);
  return level >= 1 ? <>{label} <BrandDivider /> {promo}</> : label;
}

/** Bouton « Trouver un lien avec… » qui s'ouvre sur une recherche d'étudiant. */
export function RelationSearch({ students, excludeId, onChoose }) {
  const listId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => {
    if (!normalizeStudentSearch(query)) return [];
    const candidates = students.filter((student) => student.id !== excludeId);
    return searchStudentsByName(candidates, query, undefined, { prefixOnly: true });
  }, [students, excludeId, query]);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // La liste défile : la ligne choisie au clavier doit rester visible.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  // Un clic ailleurs referme la recherche et rend le bouton.
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setQuery('');
      setActiveIndex(0);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const choose = (student) => {
    if (!student) return;
    close();
    onChoose(student.id);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      choose(results[activeIndex] ?? results[0]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  if (!open) {
    return (
      <button type="button" className="card__relation-open card__relation-start" onClick={() => setOpen(true)}>
        Trouver un lien avec…
      </button>
    );
  }

  return (
    <div className="card__relation-search card__relation-start" ref={rootRef}>
      <div className="card__relation-field">
        <input
          ref={inputRef}
          type="search"
          value={query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Nom de l’autre étudiant"
          aria-label="Trouver le lien avec un autre étudiant"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[activeIndex] ? `${listId}-${results[activeIndex].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {normalizeStudentSearch(query) && (
        <ul id={listId} ref={listRef} className="card__relation-results" role="listbox" aria-label="Étudiants">
          {results.length ? results.map((student, index) => (
            <li key={student.id}>
              <button
                id={`${listId}-${student.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`card__relation-option${index === activeIndex ? ' is-active' : ''}`}
                style={{ '--relation-color': promoStyle(student.promo).color }}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(student)}
              >
                <span><NameMatch name={student.name} query={query} /></span>
                <span className="card__link-promo"><PromoLabel promo={student.promo} /></span>
              </button>
            </li>
          )) : (
            <li className="card__empty" role="status">Aucun étudiant trouvé</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** La chaîne qui relie deux étudiants, étape par étape. */
export function RelationChain({ student, target, path, kinds, onSelect, onClear }) {
  const steps = path.length - 1;
  return (
    <section className="card__section card__relation">
      <h3 className="card__section-title">Lien avec {target.name}</h3>
      {steps > 0 ? (
        <>
          <p className="card__relation-summary">
            {steps} étape{steps > 1 ? 's' : ''}
          </p>
          <ol className="card__relation-chain">
            {path.map((person, index) => {
              const { color, onColor } = promoStyle(person.promo);
              return (
                <li key={person.id}>
                  {index > 0 && (
                    <span className="card__relation-kind">
                      <BrandDivider /> {KIND_LABELS[kinds[index - 1]]}
                    </span>
                  )}
                  <button
                    type="button"
                    className="card__link"
                    style={{ '--relation-color': color, '--relation-ink': onColor }}
                    onClick={() => onSelect(person.id)}
                  >
                    <span>{person.name}</span>
                    <span className="card__link-promo"><PromoLabel promo={person.promo} /></span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="card__empty">
          Aucun lien de parrainage entre {student.name} et {target.name}.
        </p>
      )}
      <button type="button" className="card__relation-open" onClick={onClear}>
        Revenir à la famille
      </button>
    </section>
  );
}
