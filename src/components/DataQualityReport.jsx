import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { QUALITY_TYPES } from '../lib/dataQuality';

const FILTERS = [
  { id: 'open', label: 'À vérifier' },
  { id: 'dismissed', label: 'Ignorés' },
];

function describeIssue(issue, people) {
  const label = (person) => `${person.name} (${person.promo})`;
  if (issue.type === 'younger') {
    return <><strong>{label(people[0])}</strong> est parrain/marraine de <strong>{label(people[1])}</strong>.</>;
  }
  if (issue.type === 'loop') {
    return <>{[...people, people[0]].map((person) => person.name).join(' → ')}</>;
  }
  if (issue.type === 'duplicate') {
    return <><strong>{label(people[0])}</strong> et <strong>{label(people[1])}</strong> sont-ils la même personne&nbsp;?</>;
  }
  return <strong>{label(people[0])}</strong>;
}

/**
 * Signalements automatiques, sous les propositions de liens. `dismissedKeys`
 * vaut null tant que la liste des signalements ignorés n'a pas pu être lue.
 */
export default function DataQualityReport({ issues, students, dismissedKeys, error, busyKey, onEdit, onDismiss, onRestore }) {
  const [filter, setFilter] = useState('open');
  const byId = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const isDismissed = (issue) => Boolean(dismissedKeys?.has(issue.key));
  const counts = {
    open: issues.filter((issue) => !isDismissed(issue)).length,
    dismissed: issues.filter(isDismissed).length,
  };
  const visible = issues.filter((issue) => (filter === 'dismissed') === isDismissed(issue));
  const groups = Object.keys(QUALITY_TYPES)
    .map((type) => ({ type, items: visible.filter((issue) => issue.type === type) }))
    .filter(({ items }) => items.length);

  return (
    <section className="family-request-inbox data-quality" aria-labelledby="data-quality-title">
      <header className="family-request-inbox__header">
        <div>
          <h3 id="data-quality-title">Signalements automatiques</h3>
          <p>Points à vérifier repérés dans les données. Ignore ceux qui sont voulus.</p>
        </div>
      </header>

      <div className="family-request-inbox__filters" role="group" aria-label="Filtrer les signalements">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? 'is-active' : ''}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
            <span>{counts[option.id]}</span>
          </button>
        ))}
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {groups.length === 0 ? (
        <p className="family-request-inbox__empty">
          {filter === 'open' ? 'Rien à vérifier.' : 'Aucun signalement ignoré.'}
        </p>
      ) : groups.map(({ type, items }) => (
        <div className="data-quality__group" key={type}>
          <h4 className="data-quality__title">{QUALITY_TYPES[type]} ({items.length})</h4>
          <ul className="family-request-inbox__list">
            {items.map((issue) => {
              const people = issue.studentIds.map((id) => byId.get(id)).filter(Boolean);
              if (people.length !== issue.studentIds.length) return null;
              return (
                <li className="family-request-inbox__item" key={issue.key}>
                  <p>{describeIssue(issue, people)}</p>
                  <div className="family-request-inbox__actions">
                    {issue.type === 'isolated' ? (
                      <button type="button" onClick={() => onEdit(people[0].id, 'add')} disabled={busyKey !== null}>
                        Ajouter un lien
                      </button>
                    ) : people.map((person) => (
                      <button key={person.id} type="button" onClick={() => onEdit(person.id, 'edit')} disabled={busyKey !== null}>
                        Modifier {person.name}
                      </button>
                    ))}
                    {isDismissed(issue) ? (
                      <button
                        className="family-request-inbox__restore"
                        type="button"
                        onClick={() => onRestore(issue.key)}
                        disabled={busyKey !== null}
                      >
                        <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
                        <span>Remettre à vérifier</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDismiss(issue.key)}
                        disabled={busyKey !== null || dismissedKeys === null}
                      >
                        Ignorer
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
