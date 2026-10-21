export const normalizeStudentSearch = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr')
  .trim();

function studentNameRank(name, query) {
  const normalizedName = normalizeStudentSearch(name);
  if (normalizedName === query) return 0;

  const [firstName, ...surnameParts] = normalizedName.split(/\s+/);
  const surname = surnameParts.join(' ');
  if (normalizedName.startsWith(query) || firstName?.startsWith(query)) return 1;
  if (surname.startsWith(query)) return 2;
  if (normalizedName.includes(query)) return 3;
  return Number.POSITIVE_INFINITY;
}

// Renvoie [debut, fin] de la partie du nom qui correspond au debut de la recherche
// (debut du nom complet ou du nom de famille), en positions du nom d'origine.
export function findStudentNamePrefixMatch(name, rawQuery) {
  const query = normalizeStudentSearch(rawQuery);
  const original = String(name ?? '');
  if (!query) return null;

  const chars = [...original];
  const starts = [];
  let normalized = '';
  let offset = 0;
  for (const char of chars) {
    starts.push({ normalizedIndex: normalized.length, originalIndex: offset });
    normalized += normalizeStudentSearch(char) || (/\s/.test(char) ? ' ' : '');
    offset += char.length;
  }

  const toOriginal = (normalizedIndex) => {
    const entry = starts.find((item) => item.normalizedIndex >= normalizedIndex);
    return entry ? entry.originalIndex : original.length;
  };

  const nameStart = normalized.search(/\S/);
  if (nameStart < 0) return null;
  const surnameStart = normalized.slice(nameStart).search(/\s\S/);
  const candidates = [nameStart];
  if (surnameStart >= 0) candidates.push(nameStart + surnameStart + 1);

  const matchStart = candidates.find((start) => normalized.startsWith(query, start));
  if (matchStart === undefined) return null;
  return [toOriginal(matchStart), toOriginal(matchStart + query.length)];
}

export function searchStudentsByName(students, rawQuery, getExtraSearchText = () => '', { prefixOnly = false } = {}) {
  const query = normalizeStudentSearch(rawQuery);
  if (!query) return [...students];
  const maxRank = prefixOnly ? 2 : Number.POSITIVE_INFINITY;

  return students
    .map((student, index) => {
      const nameRank = studentNameRank(student.name, query);
      const extraTextMatches = normalizeStudentSearch(getExtraSearchText(student)).includes(query);
      return {
        student,
        index,
        rank: Number.isFinite(nameRank) ? nameRank : extraTextMatches ? 4 : Number.POSITIVE_INFINITY,
      };
    })
    .filter(({ rank }) => Number.isFinite(rank) && rank <= maxRank)
    .sort((a, b) => a.rank - b.rank
      || a.student.name.localeCompare(b.student.name, 'fr', { sensitivity: 'base' })
      || a.index - b.index)
    .map(({ student }) => student);
}
