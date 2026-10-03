import workbookFallback from '../data/familyWorkbookFallback.json';
import { parseStudentsCsv } from './csv';
import { fetchSharedCsv, isSupabaseConfigured } from './supabase';

const fallbackData = (warning) => ({
  data: workbookFallback,
  warnings: warning ? [warning] : [],
  source: 'workbook',
});

// Supabase est la source active. Le classeur fourni sert de secours si le service
// partagé n’est pas configuré ou momentanément indisponible.
export async function loadData() {
  if (!isSupabaseConfigured()) return fallbackData();

  try {
    const sharedCsv = await fetchSharedCsv();
    if (!sharedCsv) return fallbackData('Base Supabase vide ; utilisation de la base Excel intégrée.');
    const shared = parseStudentsCsv(sharedCsv);
    if (shared.warnings.length) console.warn(`[familles] ${shared.warnings.length} avertissement(s) :\n` + shared.warnings.join('\n'));
    return { data: shared.data, warnings: shared.warnings, source: 'shared' };
  } catch (error) {
    return fallbackData(`Base Supabase indisponible : ${error.message}. La base Excel intégrée est utilisée.`);
  }
}
