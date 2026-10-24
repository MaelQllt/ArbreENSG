import { normalizeStudentSearch } from './studentSearch';

// Adresses partageables de l'arbre :
//   #etudiant/mael-quillat               ouvre une fiche
//   #lien/mael-quillat/jules-housez      ouvre le lien entre deux étudiants
// Les autres # (le jeu, les retours de connexion Supabase…) ne nous concernent pas.

export const studentSlug = (name) => normalizeStudentSearch(name)
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export function parseAppHash(hash) {
  const parts = String(hash ?? '').replace(/^#/, '').split('/').map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts[0] === 'etudiant' && parts.length === 2 && parts[1]) return { studentSlug: parts[1] };
  if (parts[0] === 'lien' && parts.length === 3 && parts[1] && parts[2]) {
    return { studentSlug: parts[1], relationSlug: parts[2] };
  }
  return null;
}

/** Vrai si l'adresse actuelle peut être réécrite par l'arbre sans rien perdre. */
export function isAppHash(hash) {
  return !hash || hash === '#' || parseAppHash(hash) !== null;
}

export function buildAppHash(studentName, relationName) {
  if (!studentName) return '';
  return relationName
    ? `#lien/${studentSlug(studentName)}/${studentSlug(relationName)}`
    : `#etudiant/${studentSlug(studentName)}`;
}
