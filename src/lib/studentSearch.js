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

export function searchStudentsByName(students, rawQuery, getExtraSearchText = () => '') {
  const query = normalizeStudentSearch(rawQuery);
  if (!query) return [...students];

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
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank
      || a.student.name.localeCompare(b.student.name, 'fr', { sensitivity: 'base' })
      || a.index - b.index)
    .map(({ student }) => student);
}
