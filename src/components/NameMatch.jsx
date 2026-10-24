import { findStudentNamePrefixMatch } from '../lib/studentSearch';

// Nom avec la partie qui correspond à la recherche soulignée.
export default function NameMatch({ name, query, className = 'name-match' }) {
  const match = findStudentNamePrefixMatch(name, query);
  if (!match) return name;
  const [start, end] = match;
  return (
    <>
      {name.slice(0, start)}
      <span className={className}>{name.slice(start, end)}</span>
      {name.slice(end)}
    </>
  );
}
