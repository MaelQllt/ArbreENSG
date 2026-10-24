import { studentSlug } from './appHash';

// Import d'une nouvelle promo depuis le trombinoscope PDF de l'école.
//
// Chaque photo porte deux libellés centrés dessous : le NOM en capitales, puis
// le ou les prénoms. Lire le texte ligne par ligne ne suffit pas (« DE BEER »,
// « Kouakou Kan José Marcel » contiennent des espaces) : on associe donc chaque
// NOM au prénom placé juste en dessous, dans la même colonne.

const SAME_LINE = 2; // écart vertical (pt) entre deux textes d'une même ligne
const NAME_TO_FIRST_NAME = 25; // écart vertical maximal entre un NOM et ses prénoms
const SAME_COLUMN = 35; // écart horizontal maximal entre les centres des deux libellés

const words = (value) => studentSlug(value).split('-').filter(Boolean);
const isUpperCase = (value) => /\p{L}/u.test(value) && value === value.toLocaleUpperCase('fr');

/** Formation et année d'entrée lues dans le titre, par exemple « Ingénieur de l'ENSG 1ère année 2023-2024 ». */
export function parsePromoTitle(title) {
  const text = words(title).join(' ');
  const code = /licence|geometre/.test(text) ? 'LG' : /ingenieur/.test(text) ? 'ING' : '';
  const years = String(title).match(/(\d{4})\s*[-–/]\s*\d{4}/);
  const level = String(title).match(/(\d)\s*(?:ère|ere|re|ème|eme|e)\s+année/i);
  const promo = years ? Number(years[1]) - (level ? Number(level[1]) - 1 : 0) : null;
  return { code, promo };
}

/**
 * `pages` : [{ items: [{ str, x, y, width }] }], les textes de chaque page avec
 * leur position (origine en bas à gauche, comme dans le PDF).
 */
export function parsePromoPdfPages(pages) {
  const students = [];
  const warnings = [];
  let title = '';

  pages.forEach((page, pageIndex) => {
    const lines = [];
    page.items
      .map((item) => ({ ...item, str: String(item.str).replace(/\s+/g, ' ').trim() }))
      .filter((item) => item.str)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach((item) => {
        const cell = { str: item.str, center: item.x + (item.width ?? 0) / 2 };
        const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE);
        if (line) line.cells.push(cell);
        else lines.push({ y: item.y, cells: [cell] });
      });

    const isNameLine = (line) => line.cells.every((cell) => isUpperCase(cell.str));
    const usable = lines.filter((line) => {
      const text = line.cells.map((cell) => cell.str).join(' ');
      if (/^page \d+\s*\/\s*\d+$/i.test(text)) return false;
      if (/année/i.test(text) && !isNameLine(line)) {
        title ||= text;
        return false;
      }
      return true;
    });

    usable.forEach((line, lineIndex) => {
      if (!isNameLine(line)) return;
      const next = usable[lineIndex + 1];
      const firstNames = next && !isNameLine(next) && line.y - next.y <= NAME_TO_FIRST_NAME ? next.cells : [];
      line.cells.forEach((cell) => {
        let best = null;
        firstNames.forEach((candidate) => {
          const distance = Math.abs(candidate.center - cell.center);
          if (distance <= SAME_COLUMN && (!best || distance < best.distance)) best = { candidate, distance };
        });
        students.push({ lastName: cell.str.toLocaleUpperCase('fr'), firstName: best?.candidate.str ?? '' });
        if (!best) warnings.push(`Page ${pageIndex + 1} : prénom introuvable pour ${cell.str}.`);
      });
    });
  });

  return { title, ...parsePromoTitle(title), students, warnings };
}

/**
 * Compare les étudiants lus dans le PDF à la base. La base garde souvent le
 * prénom d'usage (« Marcel ASSIE » pour « Kouakou Kan José Marcel ASSIE ») :
 * un même nom de famille avec un prénom en commun compte comme déjà présent.
 *   new       à ajouter
 *   existing  même nom complet dans la base
 *   probable  même nom de famille et un prénom en commun
 *   homonym   même nom de famille seulement (frère, sœur…) : ajouté par défaut
 */
export function matchPromoStudents(students, existingNodes) {
  // Dans la base, le nom de famille est la partie en capitales (« Edmond SAINT DENIS »).
  const existing = existingNodes.map((node) => {
    const parts = String(node.name).trim().split(/\s+/);
    const firstUpper = parts.findIndex((part) => isUpperCase(part));
    const split = firstUpper > 0 ? firstUpper : parts.length - 1;
    return {
      node,
      firstNames: words(parts.slice(0, split).join(' ')),
      lastName: words(parts.slice(split).join(' ')).join(' '),
    };
  });
  // « Abi » pour « Abigaëlle », « Augustin » pour « Augustin-Pierre ».
  const sameFirstName = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

  return students.map((student, index) => {
    const firstNames = words(student.firstName);
    const lastName = words(student.lastName).join(' ');
    const sameLastName = existing.filter((candidate) => lastName && candidate.lastName === lastName);
    const exact = sameLastName.find((candidate) => candidate.firstNames.join(' ') === firstNames.join(' '));
    const probable = sameLastName.find((candidate) => (
      candidate.firstNames.some((word) => firstNames.some((other) => sameFirstName(word, other)))
    ));
    const match = exact ?? probable ?? sameLastName[0] ?? null;
    const status = exact ? 'existing' : probable ? 'probable' : match ? 'homonym' : 'new';
    return {
      key: `${index}-${student.lastName}-${student.firstName}`,
      name: [student.firstName, student.lastName].filter(Boolean).join(' '),
      status,
      match: match?.node ?? null,
      selected: status === 'new' || status === 'homonym',
    };
  });
}

/** Textes et positions de chaque page d'un PDF (navigateur). pdf.js n'est chargé qu'ici. */
export async function readPdfTextPages(file) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      pages.push({
        items: items
          .filter((item) => 'str' in item)
          .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width })),
      });
    }
    return pages;
  } finally {
    await document.destroy();
  }
}
