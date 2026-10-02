import mock from '../data/mockData';
import { parseStudentsCsv } from './csv';
import { fetchSharedCsv, isSupabaseConfigured } from './supabase';

// Source des données, par ordre de priorité :
async function loadReferenceData() {
  const url = import.meta.env.VITE_SHEET_CSV_URL || `${import.meta.env.BASE_URL}students.csv`;
  const response = await fetch(url, { cache: 'no-store' });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || type.includes('text/html')) return null;
  return parseStudentsCsv(await response.text());
}

// Le CSV d'origine sert de base initiale/fallback. Dès qu'une base partagée existe,
// elle devient la source active afin que les anciennes données n'annulent pas les suppressions.
export async function loadData() {
  if (isSupabaseConfigured()) {
    try {
      const sharedCsv = await fetchSharedCsv();
      if (sharedCsv) {
        const shared = parseStudentsCsv(sharedCsv);
        if (shared.warnings.length) console.warn(`[familles] ${shared.warnings.length} avertissement(s) :\n` + shared.warnings.join('\n'));
        return { data: shared.data, warnings: shared.warnings, source: 'shared' };
      }
    } catch (error) {
      const sharedWarning = `Base partagée indisponible : ${error.message}`;
      try {
        const reference = await loadReferenceData();
        if (reference) return { ...reference, warnings: [sharedWarning, ...reference.warnings], source: 'csv' };
      } catch (csvError) {
        console.error('[familles] Impossible de lire le CSV :', csvError);
        return { data: mock, warnings: [`CSV illisible : ${csvError.message}`, sharedWarning], source: 'mock' };
      }
      return { data: mock, warnings: [sharedWarning], source: 'mock' };
    }
  }

  try {
    const reference = await loadReferenceData();
    if (reference) {
      if (reference.warnings.length) console.warn(`[familles] ${reference.warnings.length} avertissement(s) :\n` + reference.warnings.join('\n'));
      return { ...reference, source: 'csv' };
    }
  } catch (error) {
    console.error('[familles] Impossible de lire le CSV :', error);
    return { data: mock, warnings: [`CSV illisible : ${error.message}`], source: 'mock' };
  }
  return { data: mock, warnings: [], source: 'mock' };
}
