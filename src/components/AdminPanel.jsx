import { useEffect, useMemo, useRef, useState } from 'react';
import { parseStudentsCsv, serializeStudentsCsv } from '../lib/csv';
import { formatCodeYear } from '../lib/promo';
import { buildFamilyWorkbook } from '../lib/xlsxWorkbook';
import { importFamilyWorkbook } from '../lib/xlsxImport';
import BrandDivider from './BrandDivider';
import {
  createFamilyDataVersion,
  getSuperadminSession,
  isSupabaseConfigured,
  saveSharedCsv,
  signInSuperadmin,
  signOutSuperadmin,
} from '../lib/supabase';

const normalizeName = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

const endpointId = (value) => (typeof value === 'object' ? value.id : value);

const getCurrentPromoYear = (date) => date.getFullYear() - (date.getMonth() < 8 ? 1 : 0);

const promoLabel = (student) =>
  student.code ? formatCodeYear(student.code, student.promo) : String(student.promo);

function StudentOptionLabel({ student }) {
  return (
    <span className="admin-student-select__label">
      <span className="admin-student-select__name">{student.name}</span>
      <BrandDivider />
      <span className="admin-student-select__promo">{promoLabel(student)}</span>
    </span>
  );
}

function StudentSelect({ id, label, students, value, onChange, disabled = false, emptyLabel }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = students.find((student) => student.id === value);
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
  const filteredStudents = students.filter((student) => {
    const searchable = student.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    return searchable.includes(normalizedQuery);
  });
  const activeStudent = filteredStudents[activeIndex] ?? filteredStudents[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    searchRef.current?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredStudents.findIndex((student) => student.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, value]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (student) => {
    if (!student) return;
    onChange(student.id);
    close(true);
  };

  const moveActive = (direction) => {
    if (!filteredStudents.length) return;
    setActiveIndex((index) => (index + direction + filteredStudents.length) % filteredStudents.length);
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeStudent);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

  return (
    <div className="admin-student-select" ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="admin-student-select__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {selected ? <StudentOptionLabel student={selected} /> : <span>{emptyLabel ?? 'Choisir un étudiant'}</span>}
      </button>
      {open && (
        <div className="admin-student-select__popover">
          <input
            ref={searchRef}
            className="admin-student-select__search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Rechercher un étudiant"
            aria-label={`Rechercher — ${label}`}
            aria-controls={`${id}-listbox`}
            aria-activedescendant={activeStudent ? `${id}-option-${activeIndex}` : undefined}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
          />
          <div id={`${id}-listbox`} className="admin-student-select__options" role="listbox" aria-label={label}>
            {filteredStudents.length ? filteredStudents.map((student, index) => (
              <div
                id={`${id}-option-${index}`}
                key={student.id}
                className={`admin-student-select__option${student.id === value ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={student.id === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(student)}
              >
                <StudentOptionLabel student={student} />
              </div>
            )) : <p className="admin-student-select__empty">Aucun résultat</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel({
  data,
  initialSelectedId,
  quickAddRequest,
  onQuickAddHandled,
  onAdminStatus,
  onSaved,
}) {
  const workbookInputRef = useRef(null);
  const handledQuickAddRef = useRef(null);
  const previousPromoYearRef = useRef(getCurrentPromoYear(new Date()));
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [anchorId, setAnchorId] = useState(initialSelectedId || data.nodes[0]?.id || '');
  const [relationAction, setRelationAction] = useState('add');
  const [relationType, setRelationType] = useState('parrain');
  const [personType, setPersonType] = useState('existing');
  const [existingId, setExistingId] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [currentPromoYear, setCurrentPromoYear] = useState(() => getCurrentPromoYear(new Date()));
  const [newPromo, setNewPromo] = useState(() => String(getCurrentPromoYear(new Date())));
  const [newCode, setNewCode] = useState('');
  const [newFiliere, setNewFiliere] = useState('');

  useEffect(() => {
    let timeout;
    const updateAtSeptember = () => {
      const now = new Date();
      const nextYear = getCurrentPromoYear(now);
      setCurrentPromoYear(nextYear);
      const nextSeptember = new Date(now.getFullYear() + (now.getMonth() >= 8 ? 1 : 0), 8, 1, 0, 0, 1);
      timeout = window.setTimeout(updateAtSeptember, Math.max(1000, nextSeptember.getTime() - now.getTime()));
    };
    updateAtSeptember();
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    setNewPromo((selectedYear) => selectedYear === String(previousPromoYearRef.current)
      ? String(currentPromoYear)
      : selectedYear);
    previousPromoYearRef.current = currentPromoYear;
  }, [currentPromoYear]);

  useEffect(() => {
    let active = true;
    getSuperadminSession()
      .then((savedSession) => {
        if (active) setSession(savedSession);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onAdminStatus?.(!restoring && Boolean(session));
  }, [onAdminStatus, restoring, session]);

  useEffect(() => {
    if (initialSelectedId && data.nodes.some((node) => node.id === initialSelectedId)) {
      setAnchorId(initialSelectedId);
    } else {
      setAnchorId((currentId) => (data.nodes.some((node) => node.id === currentId) ? currentId : data.nodes[0]?.id ?? ''));
    }
  }, [initialSelectedId, data]);

  useEffect(() => {
    if (!quickAddRequest || handledQuickAddRef.current === quickAddRequest.id || restoring) return;
    handledQuickAddRef.current = quickAddRequest.id;
    const anchorExists = data.nodes.some((node) => node.id === quickAddRequest.anchorId);
    const relatedExists = data.nodes.some((node) => node.id === quickAddRequest.relatedId);
    if (session && anchorExists && relatedExists && quickAddRequest.anchorId !== quickAddRequest.relatedId) {
      setError('');
      setMessage('');
      setAnchorId(quickAddRequest.anchorId);
      setRelationAction('add');
      setRelationType('parrain');
      setPersonType('existing');
      setExistingId(quickAddRequest.relatedId);
      setDialog('admin');
    }
    onQuickAddHandled?.(quickAddRequest.id);
  }, [quickAddRequest, restoring, session, data.nodes, onQuickAddHandled]);

  const students = useMemo(
    () => [...data.nodes].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [data.nodes]
  );
  const availableExisting = useMemo(
    () => students.filter((student) => student.id !== anchorId),
    [students, anchorId]
  );
  const removablePeople = useMemo(() => {
    const connectedIds = new Set();
    data.links.forEach((link) => {
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      if (relationType === 'parrain' && targetId === anchorId) connectedIds.add(sourceId);
      if (relationType === 'fillot' && sourceId === anchorId) connectedIds.add(targetId);
    });
    return students.filter((student) => connectedIds.has(student.id));
  }, [students, data.links, relationType, anchorId]);
  const selectablePeople = relationAction === 'remove' ? removablePeople : availableExisting;

  useEffect(() => {
    if (!selectablePeople.some((student) => student.id === existingId)) {
      setExistingId(selectablePeople[0]?.id ?? '');
    }
  }, [selectablePeople, existingId]);

  if (!isSupabaseConfigured()) return null;

  const closeDialog = () => {
    setDialog(null);
    setError('');
    setMessage('');
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await signInSuperadmin(email.trim(), password);
      setSession(signedIn);
      setPassword('');
      setDialog('admin');
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await signOutSuperadmin(session);
    } catch (logoutError) {
      setError(`Session fermée sur cet appareil. ${logoutError.message}`);
    } finally {
      setSession(null);
      setDialog(null);
      setBusy(false);
    }
  };

  const handleCreateBase = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const csv = serializeStudentsCsv(data);
      const workbook = buildFamilyWorkbook(data);
      const result = await createFamilyDataVersion(csv, session);
      setSession(result.session);
      const url = URL.createObjectURL(new Blob([workbook], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `geodata-familles-base-v${result.version}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`La base v${result.version} est activée et téléchargée. Le students.csv d’origine reste conservé.`);
    } catch (exportError) {
      const detail = /archive_family_data_version|schema cache|404/i.test(exportError.message)
        ? 'Exécute d’abord le script supabase/versioned_exports.sql dans Supabase SQL Editor.'
        : exportError.message;
      setError(`La nouvelle base n’a pas pu être créée : ${detail}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImportBase = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const imported = await importFamilyWorkbook(file);
      const result = await createFamilyDataVersion(imported.csv, session);
      setSession(result.session);
      onSaved(imported.data, []);
      setMessage(`Le classeur a été importé comme nouvelle base v${result.version}. Les versions précédentes sont conservées.`);
    } catch (importError) {
      setError(`Le classeur n’a pas été importé : ${importError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const anchor = data.nodes.find((node) => node.id === anchorId);
    if (!anchor) return setError('Choisis un étudiant de référence.');

    let person = relationAction === 'add' && personType === 'new'
      ? null
      : data.nodes.find((node) => node.id === existingId);
    const nextNodes = [...data.nodes];
    if (relationAction === 'add' && personType === 'new') {
      const firstName = newFirstName.trim().replace(/\s+/g, ' ');
      const lastName = newLastName.trim().replace(/\s+/g, ' ').toLocaleUpperCase('fr');
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const year = Number(newPromo);
      if (!firstName || !lastName) return setError('Saisis le prénom et le nom de la nouvelle personne.');
      if (!Number.isInteger(year) || year < 2000 || year > currentPromoYear) return setError('Choisis une année de promo comprise entre 2000 et l’année en cours.');
      const normalized = normalizeName(name);
      if (data.nodes.some((node) => normalizeName(node.name) === normalized)) {
        return setError('Une personne avec ce nom existe déjà. Sélectionne-la dans la liste.');
      }
      const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      person = {
        id: `admin-${unique}`,
        name,
        promo: year,
        code: newCode.trim() || undefined,
        filiere: newFiliere.trim() || undefined,
      };
      nextNodes.push(person);
    }
    if (!person) return setError('Choisis la personne à relier.');
    if (person.id === anchor.id) return setError('Un étudiant ne peut pas être son propre parrain ou fillot.');
    if (relationAction === 'remove' && !removablePeople.some((candidate) => candidate.id === person.id)) {
      return setError('Choisis un lien existant à supprimer.');
    }

    const source = relationType === 'parrain' ? person.id : anchor.id;
    const target = relationType === 'parrain' ? anchor.id : person.id;
    const exists = data.links.some((link) => endpointId(link.source) === source && endpointId(link.target) === target);
    if (relationAction === 'add' && exists) return setError('Ce lien existe déjà.');
    if (relationAction === 'remove' && !exists) return setError('Ce lien n’existe plus. Recharge les données puis réessaie.');

    const nextLinks = relationAction === 'remove'
      ? data.links.filter((link) => endpointId(link.source) !== source || endpointId(link.target) !== target)
      : [...data.links, { source, target }];
    const nextData = { nodes: nextNodes, links: nextLinks };
    const csv = serializeStudentsCsv(nextData);
    const parsed = parseStudentsCsv(csv);
    setBusy(true);
    try {
      const updatedSession = await saveSharedCsv(csv, session);
      setSession(updatedSession);
      // Garder les identifiants React et graphe en place après la sauvegarde.
      onSaved(nextData, parsed.warnings);
      setMessage(relationAction === 'remove'
        ? `Le lien avec ${person.name} a été supprimé.`
        : `${person.name} a été ajouté·e à la famille de ${anchor.name}.`);
      if (relationAction === 'add' && personType === 'new') {
        setNewFirstName('');
        setNewLastName('');
        setNewCode('');
        setNewFiliere('');
        setPersonType('existing');
      }
    } catch (saveError) {
      setError(`La sauvegarde a échoué : ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-access">
        <button
          type="button"
          className="btn btn--ghost admin-access__button"
          disabled={restoring}
          onClick={() => {
            setError('');
            setMessage('');
            setDialog(session ? 'admin' : 'login');
          }}
        >
          Admin
        </button>
      </div>

      {dialog && (
        <div className="admin-scrim" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
          {dialog === 'login' ? (
            <section className="admin-panel admin-panel--login" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
              <header className="admin-panel__header">
                <div>
                  <p className="admin-panel__eyebrow">Accès réservé</p>
                  <h2 id="admin-login-title">Connexion superadmin</h2>
                </div>
                <button type="button" className="admin-panel__close" onClick={closeDialog} aria-label="Fermer">
                  ×
                </button>
              </header>
              <form className="admin-form" onSubmit={handleLogin}>
                <label>
                  E-mail
                  <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label>
                  Mot de passe
                  <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </label>
                {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                <button className="btn admin-submit" type="submit" disabled={busy}>
                  {busy ? 'Connexion…' : 'Se connecter'}
                </button>
              </form>
            </section>
          ) : (
            <section className="admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title">
              <header className="admin-panel__header">
                <div>
                  <p className="admin-panel__eyebrow">Superadmin · {session?.user?.email}</p>
                  <h2 id="admin-title">Gestion des familles</h2>
                </div>
                <div className="admin-panel__actions">
                  <button type="button" className="admin-panel__logout" onClick={handleLogout} disabled={busy}>Déconnexion</button>
                  <button type="button" className="admin-panel__close" onClick={closeDialog} aria-label="Fermer">×</button>
                </div>
              </header>

              <form className="admin-form" onSubmit={handleSave}>
                <div className="admin-selection">
                  <span className="admin-selection__title">Étudiant.e concerné.e</span>
                  <StudentSelect
                    id="anchor-student"
                    label="Étudiant.e concerné.e"
                    students={students}
                    value={anchorId}
                    onChange={setAnchorId}
                  />
                </div>

                <div className="admin-field">
                  <span className="admin-field__label">Action sur les liens</span>
                  <div className="admin-tabs" role="tablist" aria-label="Ajouter ou supprimer un lien">
                    <button type="button" role="tab" aria-selected={relationAction === 'add'} className={relationAction === 'add' ? 'is-active' : ''} onClick={() => setRelationAction('add')}>
                      Ajouter
                    </button>
                    <button type="button" role="tab" aria-selected={relationAction === 'remove'} className={relationAction === 'remove' ? 'is-active' : ''} onClick={() => setRelationAction('remove')}>
                      Supprimer un lien
                    </button>
                  </div>
                </div>

                <div className="admin-field">
                  <span className="admin-field__label">{relationAction === 'remove' ? 'Quel lien ?' : 'Ajouter à sa famille'}</span>
                  <div className="admin-tabs" role="tablist" aria-label="Type de relation">
                    <button type="button" role="tab" aria-selected={relationType === 'parrain'} className={relationType === 'parrain' ? 'is-active' : ''} onClick={() => setRelationType('parrain')}>
                      Un parrain / une marraine
                    </button>
                    <button type="button" role="tab" aria-selected={relationType === 'fillot'} className={relationType === 'fillot' ? 'is-active' : ''} onClick={() => setRelationType('fillot')}>
                      Un fillot / une fillotte
                    </button>
                  </div>
                </div>

                {relationAction === 'add' && (
                  <div className="admin-field">
                    <span className="admin-field__label">Personne à ajouter</span>
                    <div className="admin-tabs admin-tabs--compact" role="tablist" aria-label="Personne existante ou nouvelle">
                      <button type="button" role="tab" aria-selected={personType === 'existing'} className={personType === 'existing' ? 'is-active' : ''} onClick={() => setPersonType('existing')}>
                        Déjà dans le graphe
                      </button>
                      <button type="button" role="tab" aria-selected={personType === 'new'} className={personType === 'new' ? 'is-active' : ''} onClick={() => setPersonType('new')}>
                        Créer une personne
                      </button>
                    </div>
                  </div>
                )}

                {relationAction === 'remove' || personType === 'existing' ? (
                  <div className="admin-selection">
                    <span className="admin-selection__title">
                      {relationAction === 'remove' ? 'Personne liée' : 'Personne'}
                    </span>
                    <StudentSelect
                      id="related-student"
                      label={relationAction === 'remove' ? 'Personne liée' : 'Personne'}
                      students={selectablePeople}
                      value={existingId}
                      onChange={setExistingId}
                      disabled={!selectablePeople.length}
                      emptyLabel="Aucun lien de ce type pour cet étudiant"
                    />
                  </div>
                ) : (
                  <div className="admin-form__new-person">
                    <div className="admin-form__row">
                      <label>
                        Prénom
                        <input value={newFirstName} onChange={(event) => setNewFirstName(event.target.value)} placeholder="Ex. Tom" required />
                      </label>
                      <label>
                        Nom
                        <input value={newLastName} onChange={(event) => setNewLastName(event.target.value.toLocaleUpperCase('fr'))} placeholder="Ex. MARTIN" required />
                      </label>
                    </div>
                    <div className="admin-form__row">
                      <label>
                        Année d’arrivée
                        <select value={newPromo} onChange={(event) => setNewPromo(event.target.value)} required>
                          {Array.from({ length: Math.max(0, currentPromoYear - 1999) }, (_, index) => currentPromoYear - index).map((year) => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Code
                        <select value={newCode} onChange={(event) => setNewCode(event.target.value)}>
                          <option value="">Choisir un code</option>
                          {['ING', 'LG', 'M'].map((code) => <option key={code} value={code}>{code}</option>)}
                        </select>
                      </label>
                    </div>
                    <label>
                      Filière
                      <select value={newFiliere} onChange={(event) => setNewFiliere(event.target.value)}>
                        <option value="">Aucune filière</option>
                        {['Carthagéo', 'IGAST', 'TSI', 'PPMD', 'GDS', 'DDMEG', 'GDM', 'Double diplôme', 'FRS'].map((filiere) => <option key={filiere} value={filiere}>{filiere}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                <p className="admin-form__hint">
                  {relationAction === 'remove'
                    ? `Seuls les ${relationType === 'parrain' ? 'parrains et marraines' : 'fillots et fillottes'} déjà liés à cet étudiant sont proposés.`
                    : relationType === 'parrain'
                      ? 'La personne choisie sera reliée comme parrain ou marraine de l’étudiant concerné.'
                      : 'La personne choisie sera reliée comme fillot ou fillotte de l’étudiant concerné.'}
                </p>
                {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
                <p className="admin-form__hint">
                  Pour appliquer des changements faits dans Excel, importe ici le classeur modifié. Il devient une nouvelle base active ; les versions précédentes restent conservées.
                </p>
                <footer className="admin-form__footer">
                  <input
                    ref={workbookInputRef}
                    className="admin-form__file-input"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleImportBase}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <button type="button" className="admin-panel__logout" onClick={closeDialog}>Fermer</button>
                  <button type="button" className="admin-panel__logout" onClick={() => workbookInputRef.current?.click()} disabled={busy}>
                    {busy ? 'Importation…' : 'Importer un classeur (.xlsx)'}
                  </button>
                  <button type="button" className="admin-panel__logout" onClick={handleCreateBase} disabled={busy || !data.nodes.length}>
                    {busy ? 'Création de la base…' : 'Créer et télécharger la base (.xlsx)'}
                  </button>
                  <button className="btn admin-submit" type="submit" disabled={busy || !data.nodes.length || (relationAction === 'remove' ? !selectablePeople.some((student) => student.id === existingId) : personType === 'existing' && !availableExisting.length)}>
                    {busy ? 'Enregistrement…' : relationAction === 'remove' ? 'Supprimer le lien' : 'Enregistrer dans la base partagée'}
                  </button>
                </footer>
              </form>
            </section>
          )}
        </div>
      )}
    </>
  );
}
