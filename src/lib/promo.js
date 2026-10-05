// "promo" = année d'entrée à l'école (ex. 2024).
// L'année universitaire commence le 1er septembre :
//   du 01/09/2026 au 31/08/2027, la promo 2024 est en IT3, la promo 2022 en IT5, la promo 2021 en IT6.
// Le niveau est recalculé à partir de la date du jour et continue d'incrémenter (IT6, IT7...) :
// aucune mise à jour manuelle.

const FILIERE_FROM_LEVEL = 3;   // les filières commencent en IT3
const GRADUATED_FROM_LEVEL = 4; // à partir d'IT4 : diplômé·es

export function formatCodeYear(code, year) {
  if (!code) return '';
  return `${String(code).trim().toLocaleUpperCase('fr')}${String(year).slice(-2)}`;
}

export function parseAdditionalAffiliations(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/[|;,\n]+/)
    .map((label) => label.trim().toLocaleUpperCase('fr'))
    .filter(Boolean)
    .flatMap((label) => {
      const match = label.match(/^([A-Z][A-Z0-9-]*?)(\d{4}|\d{2})$/);
      if (!match) return [];
      const code = match[1];
      const parsedYear = Number(match[2]);
      const promo = match[2].length === 2 ? 2000 + parsedYear : parsedYear;
      const key = `${code}-${promo}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ code, promo }];
    });
}

export function serializeAdditionalAffiliations(affiliations = []) {
  return affiliations
    .map(({ code, promo }) => formatCodeYear(code, promo))
    .filter(Boolean)
    .join(' | ');
}

export function formatStudentAffiliations(student) {
  return [
    formatCodeYear(student.code, student.promo),
    ...(student.additionalAffiliations ?? []).map(({ code, promo }) => formatCodeYear(code, promo)),
  ].filter(Boolean).join('/');
}

export function academicYearStart(date = new Date()) {
  const year = date.getFullYear();
  return date.getMonth() >= 8 ? year : year - 1; // mois 8 = septembre
}

export function getLevel(promo, date = new Date()) {
  return academicYearStart(date) - promo + 1;
}

export function describePromo(promo, date = new Date()) {
  const level = getLevel(promo, date);
  if (level < 1) {
    return {
      level,
      graduated: false,
      hasFiliere: false,
      label: `Promo ${promo}`,
      detail: 'à venir',
      detailOne: 'à venir',
    };
  }
  const graduated = level >= GRADUATED_FROM_LEVEL;
  return {
    level,
    graduated,
    hasFiliere: level >= FILIERE_FROM_LEVEL,
    label: `IT${level}`,
    detail: graduated ? `Promo ${promo}, diplômé·es` : `Promo ${promo}`, // légende (groupe)
    detailOne: graduated ? `Promo ${promo}, diplômé·e` : `Promo ${promo}`, // fiche (une personne)
  };
}
