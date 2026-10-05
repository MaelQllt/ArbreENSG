import { useEffect, useMemo, useRef, useState } from 'react';
import { formatStudentAffiliations } from '../lib/promo';
import { promoStyle } from '../theme';
import BrandDivider from './BrandDivider';

const normalize = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr')
  .trim();

function SearchOption({ student }) {
  const { color } = promoStyle(student.promo);
  const codeYear = formatStudentAffiliations(student);
  return (
    <>
      <span className="student-search__name">{student.name}</span>
      <span className="student-search__promo" style={{ color }}>
        {codeYear && <>{codeYear}{(student.filiere ?? student.parcours) && <BrandDivider />}</>}
        {student.filiere ?? student.parcours ?? ''}
      </span>
    </>
  );
}

export default function StudentSearch({ students, onSelect }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = 'student-search-options';
  const normalizedQuery = normalize(query);

  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    return [...students]
      .filter((student) => normalize(`${student.name} ${formatStudentAffiliations(student)} ${student.filiere ?? student.parcours ?? ''}`).includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .slice(0, 8);
  }, [students, normalizedQuery]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const choose = (student) => {
    if (!student) return;
    onSelect(student.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && open && results.length) {
      event.preventDefault();
      choose(results[activeIndex] ?? results[0]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="student-search" ref={rootRef}>
      <div className="student-search__field">
        <svg className="student-search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m12.5 12.5 4 4" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Rechercher un étudiant"
          aria-label="Rechercher un étudiant"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(normalizedQuery)}
          aria-controls={listId}
          aria-activedescendant={open && results[activeIndex] ? `${listId}-${results[activeIndex].id}` : undefined}
          onFocus={() => normalizedQuery && setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && normalizedQuery && (
        <ul id={listId} className="student-search__results" role="listbox" aria-label="Résultats de recherche">
          {results.length ? results.map((student, index) => (
            <li key={student.id}>
              <button
                id={`${listId}-${student.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`student-search__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(student)}
              >
                <SearchOption student={student} />
              </button>
            </li>
          )) : (
            <li className="student-search__empty" role="status">Aucun étudiant trouvé</li>
          )}
        </ul>
      )}
    </div>
  );
}
