import { parseStudentsCsv, serializeStudentsCsv } from './csv';

const decoder = new TextDecoder();
const MAX_FILE_SIZE = 30 * 1024 * 1024;

function decodeXml(bytes, path) {
  const document = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error(`Le fichier Excel contient un XML illisible (${path}).`);
  return document;
}

async function unzipWorkbook(file) {
  if (file.size > MAX_FILE_SIZE) throw new Error('Le classeur dépasse la taille maximale de 30 Mo.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error('Ce fichier ne semble pas être un classeur .xlsx valide.');

  const entryCount = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const files = new Map();
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Le contenu du classeur Excel est incomplet.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Ce navigateur ne sait pas lire ce classeur compressé. Mets Safari à jour ou ouvre-le avec Chrome.');
      }
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        content = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw new Error('Impossible de décompresser le classeur. Essaie de le réenregistrer au format .xlsx.');
      }
    } else throw new Error('Le classeur utilise une compression Excel non reconnue.');
    files.set(name, content);
  }
  return files;
}

function xmlText(node) {
  return [...node.getElementsByTagName('*')]
    .filter((child) => child.localName === 't')
    .map((child) => child.textContent ?? '')
    .join('');
}

function columnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function worksheetRows(document, sharedStrings) {
  return [...document.getElementsByTagName('*')]
    .filter((element) => element.localName === 'row')
    .map((row) => {
      const values = [];
      [...row.children].filter((child) => child.localName === 'c').forEach((cell) => {
        const index = columnIndex(cell.getAttribute('r') ?? 'A');
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') value = xmlText(cell);
        else {
          const raw = [...cell.children].find((child) => child.localName === 'v')?.textContent ?? '';
          value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
        }
        values[index] = value;
      });
      return values.map((value) => value ?? '');
    });
}

function resolvePath(base, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
  const resolved = [];
  parts.forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  });
  return resolved.join('/');
}

function headerKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function csvQuote(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function nameKey(value) {
  return headerKey(value).split(' ').filter(Boolean).sort().join(' ');
}

function tablesToData(tables) {
  const rawRows = [];
  let recognizedSheets = 0;
  for (const { name, rows } of tables) {
    const headerRowIndex = rows.findIndex((row) => row.some((value) => /etudiant|prenom|nom complet/i.test(headerKey(value))) && row.some((value) => /promo|annee/i.test(headerKey(value))));
    if (headerRowIndex < 0) continue;
    const headers = rows[headerRowIndex].map(headerKey);
    const findColumn = (predicate) => headers.findIndex(predicate);
    const columns = {
      fullName: findColumn((header) => ['etudiant', 'etudiante', 'etudiant e', 'nom complet', 'name', 'eleve'].includes(header)),
      firstName: findColumn((header) => ['prenom', 'first name', 'firstname'].includes(header)),
      lastName: findColumn((header) => ['nom', 'nom de famille', 'last name', 'lastname'].includes(header)),
      promo: findColumn((header) => header.includes('promo') || header.includes('annee')),
      code: findColumn((header) => header === 'code'),
      additionalAffiliations: findColumn((header) => header.includes('appartenance') || header.includes('additional affiliation')),
      filiere: findColumn((header) => header.includes('filiere')),
      parents: findColumn((header) => header.includes('parrain') || header.includes('marraine')),
      children: findColumn((header) => header.includes('fillot') || header.includes('fillotte')),
    };
    if (columns.promo < 0 || (columns.fullName < 0 && (columns.firstName < 0 || columns.lastName < 0))) {
      throw new Error(`L’onglet « ${name} » doit contenir Étudiant·e (ou Prénom et Nom) ainsi que Promo.`);
    }
    recognizedSheets++;
    rows.slice(headerRowIndex + 1).forEach((row) => {
      if (!row.some((cell) => String(cell).trim())) return;
      const nameValue = columns.fullName >= 0
        ? row[columns.fullName]
        : `${row[columns.firstName] ?? ''} ${row[columns.lastName] ?? ''}`.trim();
      rawRows.push({
        name: String(nameValue ?? '').trim(),
        promo: row[columns.promo] ?? '',
        code: columns.code >= 0 ? row[columns.code] ?? '' : '',
        additionalAffiliations: columns.additionalAffiliations >= 0 ? row[columns.additionalAffiliations] ?? '' : '',
        filiere: columns.filiere >= 0 ? row[columns.filiere] ?? '' : '',
        parents: columns.parents >= 0 ? row[columns.parents] ?? '' : '',
        children: columns.children >= 0 ? row[columns.children] ?? '' : '',
      });
    });
  }
  if (!recognizedSheets) throw new Error('Aucun onglet avec les colonnes attendues (Étudiant·e, Promo, Code, Filière, Parrains, Fillots).');
  if (!rawRows.length) throw new Error('Aucun étudiant trouvé dans les onglets du classeur.');

  const csvRows = [
    ['etudiant', 'promo', 'code', 'appartenances secondaires', 'filiere', 'parrains'],
    ...rawRows.map((row) => [row.name, row.promo, row.code, row.additionalAffiliations, row.filiere, row.parents]),
  ];
  const parsed = parseStudentsCsv(csvRows.map((row) => row.map(csvQuote).join(',')).join('\n'));
  const idByName = new Map(parsed.data.nodes.map((student) => [nameKey(student.name), student.id]));
  const links = new Map();
  const addLink = (parentId, childId) => {
    if (!parentId || !childId || parentId === childId) return false;
    links.set(`${parentId}>${childId}`, { source: parentId, target: childId });
    return true;
  };
  parsed.data.links.forEach((link) => addLink(link.source, link.target));
  const relationWarnings = [];
  rawRows.forEach((row) => {
    const childId = idByName.get(nameKey(row.name));
    String(row.children ?? '').split(/[|;,\n]+/).map((value) => value.trim()).filter(Boolean).forEach((childName) => {
      const targetId = idByName.get(nameKey(childName));
      if (!targetId) relationWarnings.push(`Fillot/fillotte introuvable : « ${childName} » (de ${row.name}).`);
      else addLink(childId, targetId);
    });
  });
  const warnings = [...parsed.warnings, ...relationWarnings];
  if (warnings.length) {
    throw new Error(`Le classeur contient des lignes ou liens à corriger :\n${warnings.slice(0, 5).join('\n')}${warnings.length > 5 ? `\n… et ${warnings.length - 5} autre(s).` : ''}`);
  }
  return { data: { ...parsed.data, links: [...links.values()] }, csv: serializeStudentsCsv({ ...parsed.data, links: [...links.values()] }) };
}

export async function importFamilyWorkbook(file) {
  if (!file || !/\.xlsx$/i.test(file.name)) throw new Error('Choisis un fichier au format .xlsx.');
  const files = await unzipWorkbook(file);
  const workbookBytes = files.get('xl/workbook.xml');
  const relationshipsBytes = files.get('xl/_rels/workbook.xml.rels');
  if (!workbookBytes || !relationshipsBytes) throw new Error('Le classeur ne contient pas ses informations de feuilles Excel.');
  const workbook = decodeXml(workbookBytes, 'xl/workbook.xml');
  const relationships = decodeXml(relationshipsBytes, 'xl/_rels/workbook.xml.rels');
  const relationshipTargets = new Map([...relationships.getElementsByTagName('*')]
    .filter((node) => node.localName === 'Relationship')
    .map((node) => [node.getAttribute('Id'), node.getAttribute('Target')]));
  let sharedStrings = [];
  if (files.has('xl/sharedStrings.xml')) {
    const strings = decodeXml(files.get('xl/sharedStrings.xml'), 'xl/sharedStrings.xml');
    sharedStrings = [...strings.getElementsByTagName('*')]
      .filter((node) => node.localName === 'si')
      .map(xmlText);
  }

  const tables = [];
  const sheetNodes = [...workbook.getElementsByTagName('*')].filter((node) => node.localName === 'sheet');
  for (const sheet of sheetNodes) {
    if (sheet.getAttribute('state') === 'hidden') continue;
    const relationshipId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? sheet.getAttribute('r:id');
    const target = relationshipTargets.get(relationshipId);
    if (!target) continue;
    const path = resolvePath('xl', target);
    const content = files.get(path);
    if (!content) continue;
    tables.push({ name: sheet.getAttribute('name') ?? path, rows: worksheetRows(decodeXml(content, path), sharedStrings) });
  }
  return tablesToData(tables);
}
