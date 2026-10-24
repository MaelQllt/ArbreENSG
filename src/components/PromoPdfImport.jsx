import { useEffect, useRef, useState } from 'react';
import { formatStudentAffiliations } from '../lib/promo';
import BrandDivider from './BrandDivider';
import { matchPromoStudents, parsePromoPdfPages, readPdfTextPages } from '../lib/promoPdf';

const promoLabel = (student) => formatStudentAffiliations(student) || String(student.promo);

function StatusNote({ row }) {
  if (row.status === 'existing') return <span className="promo-import__note">Déjà dans la base</span>;
  if (row.status === 'probable') {
    return (
      <span className="promo-import__note promo-import__note--warning">
        Déjà dans la base&nbsp;? {row.match.name} ({promoLabel(row.match)})
      </span>
    );
  }
  if (row.status === 'homonym') {
    return (
      <span className="promo-import__note">
        Même nom que {row.match.name} ({promoLabel(row.match)})
      </span>
    );
  }
  return null;
}

function Row({ row, onChange }) {
  return (
    <li className={`promo-import__row${row.selected ? '' : ' is-unselected'}`}>
      <input
        type="checkbox"
        checked={row.selected}
        onChange={(event) => onChange({ ...row, selected: event.target.checked })}
        aria-label={`Ajouter ${row.name}`}
      />
      <div className="promo-import__person">
        <input
          className="promo-import__name"
          value={row.name}
          onChange={(event) => onChange({ ...row, name: event.target.value })}
          aria-label="Nom complet"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <StatusNote row={row} />
      </div>
    </li>
  );
}

/**
 * Lecture du trombinoscope PDF d'une promo. Le titre du PDF sert à proposer
 * l'année et le code (`onDetected`) ; la liste à ajouter remonte par `onSelectionChange`.
 */
export default function PromoPdfImport({ students, onDetected, onSelectionChange }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    onSelectionChange(rows.filter((row) => row.selected).map((row) => row.name.trim().replace(/\s+/g, ' ')));
  }, [rows, onSelectionChange]);

  const readFile = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('Choisis un fichier PDF.');
      return;
    }
    setReading(true);
    setError('');
    setFileName(file.name);
    try {
      const result = parsePromoPdfPages(await readPdfTextPages(file));
      if (!result.students.length) {
        throw new Error('aucun étudiant trouvé. Le PDF est peut-être une image scannée, sans texte.');
      }
      setTitle(result.title);
      setWarnings(result.warnings);
      setRows(matchPromoStudents(result.students, students));
      onDetected({ code: result.code, promo: result.promo });
    } catch (readError) {
      setRows([]);
      setTitle('');
      setWarnings([]);
      setError(`Lecture du PDF impossible : ${readError?.message ?? readError}`);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const updateRow = (next) => setRows((current) => current.map((row) => row.key === next.key ? next : row));
  const toReview = rows.filter((row) => row.status !== 'existing');
  const alreadyThere = rows.filter((row) => row.status === 'existing');
  const selectedCount = rows.filter((row) => row.selected).length;

  return (
    <div className="promo-import">
      <div
        className={`promo-import__drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void readFile(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          className="admin-form__file-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => void readFile(event.target.files?.[0])}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button type="button" className="admin-panel__logout" onClick={() => inputRef.current?.click()} disabled={reading}>
          {reading ? 'Lecture…' : fileName ? 'Changer de PDF' : 'Choisir le PDF du trombinoscope'}
        </button>
        <span className="promo-import__hint">
          {fileName ? <>{fileName}{title && <> <BrandDivider /> « {title} »</>}</> : 'ou dépose-le ici'}
        </span>
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {warnings.length > 0 && (
        <ul className="promo-import__warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <p className="promo-import__summary">
            {rows.length} étudiant{rows.length > 1 ? 's' : ''} dans le PDF <BrandDivider /> <strong>{selectedCount} à ajouter</strong>.
            Corrige les noms si besoin : la base utilise le prénom d’usage.
          </p>
          {toReview.length > 0 && (
            <ul className="promo-import__list">
              {toReview.map((row) => <Row key={row.key} row={row} onChange={updateRow} />)}
            </ul>
          )}
          {alreadyThere.length > 0 && (
            <details className="promo-import__existing">
              <summary>{alreadyThere.length} déjà dans la base</summary>
              <ul className="promo-import__list">
                {alreadyThere.map((row) => <Row key={row.key} row={row} onChange={updateRow} />)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
