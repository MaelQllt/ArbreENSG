import { useEffect, useMemo, useRef, useState } from 'react';
import { parseStudentsCsv, serializeStudentsCsv } from '../lib/csv';
import {
  formatStudentAffiliations,
  parseAdditionalAffiliations,
  serializeAdditionalAffiliations,
} from '../lib/promo';
import { buildFamilyWorkbook } from '../lib/xlsxWorkbook';
import { importFamilyWorkbook } from '../lib/xlsxImport';
import { searchStudentsByName } from '../lib/studentSearch';
import BrandDivider from './BrandDivider';
import FamilyLinkRequestInbox from './FamilyLinkRequestInbox';
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
const wouldCreateFamilyCycle = (links, parentId, childId) => {
  const childrenByParent = new Map();
  links.forEach((link) => {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    if (!childrenByParent.has(sourceId)) childrenByParent.set(sourceId, []);
    childrenByParent.get(sourceId).push(targetId);
  });

  const pending = [childId];
  const visited = new Set();
  while (pending.length) {
    const currentId = pending.pop();
    if (currentId === parentId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    pending.push(...(childrenByParent.get(currentId) ?? []));
  }
  return false;
};
const normalizeOptionText = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr')
  .trim();

const FILIERE_NAMES = [
  'Carthagéo', 'IGAST', 'TSI', 'PPMD', 'GDS', 'DDMEG', 'GDM', 'Double diplôme', 'FRS', 'FIRS',
];
const CODE_OPTIONS = [
  { value: '', label: 'Choisir un code' },
  ...['ING', 'LG', 'M'].map((code) => ({ value: code, label: code })),
];
const FILIERE_OPTIONS = [
  { value: '', label: 'Aucune filière' },
  ...FILIERE_NAMES.map((filiere) => ({ value: filiere, label: filiere })),
];

const addCurrentChoice = (options, value) => {
  if (value === undefined || value === null || value === '') return options;
  const stringValue = String(value);
  return options.some((option) => option.value === stringValue)
    ? options
    : [...options, { value: stringValue, label: stringValue }];
};

const getCurrentPromoYear = (date) => date.getFullYear() - (date.getMonth() < 8 ? 1 : 0);

const promoLabel = (student) =>
  formatStudentAffiliations(student) || String(student.promo);

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
  const filteredStudents = searchStudentsByName(students, query);
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

function StudentMultiSelect({ id, label, students, selectedIds, onChange, emptyLabel }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedSet = new Set(selectedIds);
  const selectedStudents = students.filter((student) => selectedSet.has(student.id));
  const filteredStudents = searchStudentsByName(students, query);

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

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const toggleStudent = (studentId) => {
    onChange(selectedSet.has(studentId)
      ? selectedIds.filter((idValue) => idValue !== studentId)
      : [...selectedIds, studentId]);
  };

  return (
    <div className="admin-student-select admin-student-multi-select" ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="admin-student-select__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        <span>{selectedStudents.length ? `${selectedStudents.length} étudiant${selectedStudents.length > 1 ? 's' : ''} sélectionné${selectedStudents.length > 1 ? 's' : ''}` : emptyLabel}</span>
      </button>
      {selectedStudents.length > 0 && (
        <div className="admin-student-multi-select__chips" aria-label="Étudiants sélectionnés">
          {selectedStudents.map((student) => (
            <span className="admin-student-multi-select__chip" key={student.id}>
              {student.name}
              <button
                type="button"
                aria-label={`Retirer ${student.name}`}
                onClick={() => toggleStudent(student.id)}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="admin-student-multi-select__clear" onClick={() => onChange([])}>
            Tout effacer
          </button>
        </div>
      )}
      {open && (
        <div className="admin-student-select__popover">
          <input
            ref={searchRef}
            className="admin-student-select__search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un étudiant"
            aria-label={`Rechercher — ${label}`}
            aria-controls={`${id}-options`}
          />
          <div id={`${id}-options`} className="admin-student-select__options" role="group" aria-label={label}>
            {filteredStudents.length ? filteredStudents.map((student) => (
              <label className="admin-student-multi-select__option" key={student.id}>
                <input
                  className="admin-student-multi-select__checkbox"
                  type="checkbox"
                  checked={selectedSet.has(student.id)}
                  onChange={() => toggleStudent(student.id)}
                />
                <StudentOptionLabel student={student} />
              </label>
            )) : <p className="admin-student-select__empty">Aucun résultat</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ChoiceSelect({ id, label, options, value, onChange, searchPlaceholder }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalizeOptionText(query);
  const filteredOptions = options.filter((option) => normalizeOptionText(option.label).includes(normalizedQuery));
  const selected = options.find((option) => option.value === value);
  const activeOption = filteredOptions[activeIndex] ?? filteredOptions[0];

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
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, value, options]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (option) => {
    if (!option) return;
    onChange(option.value);
    close(true);
  };

  const moveActive = (direction) => {
    if (!filteredOptions.length) return;
    setActiveIndex((index) => (index + direction + filteredOptions.length) % filteredOptions.length);
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) setOpen(true);
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
      choose(activeOption);
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
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="admin-student-select__label">
          <span className="admin-student-select__name">{selected?.label ?? options[0]?.label}</span>
        </span>
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
            placeholder={searchPlaceholder}
            aria-label={`Rechercher — ${label}`}
            aria-controls={`${id}-listbox`}
            aria-activedescendant={activeOption ? `${id}-option-${activeIndex}` : undefined}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
          />
          <div id={`${id}-listbox`} className="admin-student-select__options" role="listbox" aria-label={label}>
            {filteredOptions.length ? filteredOptions.map((option, index) => (
              <div
                id={`${id}-option-${index}`}
                key={option.value}
                className={`admin-student-select__option${option.value === value ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.label}
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
  deleteRequest,
  onDeleteHandled,
  quickAddRequest,
  onQuickAddHandled,
  onAdminStatus,
  onSaved,
}) {
  const workbookInputRef = useRef(null);
  const handledQuickAddRef = useRef(null);
  const handledDeleteRef = useRef(null);
  const deleteInProgressRef = useRef(false);
  const previousPromoYearRef = useRef(getCurrentPromoYear(new Date()));
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [adminSection, setAdminSection] = useState('families');
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
  const [selectedIds, setSelectedIds] = useState([]);
  const [editName, setEditName] = useState('');
  const [editPromo, setEditPromo] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editAdditionalAffiliations, setEditAdditionalAffiliations] = useState('');
  const [editFiliere, setEditFiliere] = useState('');
  const [editBio, setEditBio] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [currentPromoYear, setCurrentPromoYear] = useState(() => getCurrentPromoYear(new Date()));
  const [newPromo, setNewPromo] = useState(() => String(getCurrentPromoYear(new Date())));
  const [newCode, setNewCode] = useState('');
  const [newFiliere, setNewFiliere] = useState('');
  const promoOptions = useMemo(() => [
    { value: '', label: 'Choisir une année' },
    ...Array.from({ length: Math.max(0, currentPromoYear - 1999) }, (_, index) => {
      const year = String(currentPromoYear - index);
      return { value: year, label: year };
    }),
  ], [currentPromoYear]);
  const editingStudent = data.nodes.find((node) => node.id === anchorId);
  const editPromoOptions = addCurrentChoice(promoOptions, editingStudent?.promo);
  const editCodeOptions = addCurrentChoice(CODE_OPTIONS, editingStudent?.code);
  const editFiliereOptions = addCurrentChoice(FILIERE_OPTIONS, editingStudent?.filiere);

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
    if (relationAction !== 'edit') return;
    const student = data.nodes.find((node) => node.id === anchorId);
    if (!student) return;
    setEditName(student.name ?? '');
    setEditPromo(String(student.promo ?? ''));
    setEditCode(student.code ?? '');
    setEditAdditionalAffiliations(serializeAdditionalAffiliations(student.additionalAffiliations));
    setEditFiliere(student.filiere ?? '');
    setEditBio(student.bio ?? '');
  }, [relationAction, anchorId, data.nodes]);

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
      setSelectedIds([quickAddRequest.relatedId]);
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
  const selectedExistingPeople = availableExisting.filter((student) => selectedIds.includes(student.id));
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

  useEffect(() => {
    const availableIds = new Set(availableExisting.map((student) => student.id));
    setSelectedIds((currentIds) => currentIds.filter((studentId) => availableIds.has(studentId)));
  }, [availableExisting]);

  const hintAnchor = students.find((student) => student.id === anchorId)?.name ?? 'l’étudiant·e concerné·e';
  const anchorLinksCount = data.links.filter((link) =>
    endpointId(link.source) === anchorId || endpointId(link.target) === anchorId
  ).length;
  const hintRelated = personType === 'new'
    ? [newFirstName.trim(), newLastName.trim()].filter(Boolean).join(' ') || 'La nouvelle personne'
    : students.find((student) => student.id === existingId)?.name ?? 'La personne choisie';
  const relationshipHint = relationType === 'parrain'
    ? `${hintRelated} deviendra le parrain/marraine de ${hintAnchor}.`
    : `${hintRelated} deviendra le fillot/fillotte de ${hintAnchor}.`;
  const selectedPeopleNames = selectedExistingPeople.map((student) => student.name);
  const selectedPeopleLabel = selectedPeopleNames.length < 2
    ? selectedPeopleNames[0]
    : `${selectedPeopleNames.slice(0, -1).join(', ')} et ${selectedPeopleNames[selectedPeopleNames.length - 1]}`;
  const selectedPeopleVerb = selectedPeopleNames.length > 1 ? 'deviendront' : 'deviendra';
  const selectedRelationshipHint = selectedExistingPeople.length === 0
    ? 'Sélectionne au moins une personne.'
    : relationType === 'parrain'
      ? `${selectedPeopleLabel} ${selectedPeopleVerb} ${selectedPeopleNames.length > 1 ? 'les parrains ou marraines' : 'le parrain/marraine'} de ${hintAnchor}.`
      : `${selectedPeopleLabel} ${selectedPeopleVerb} ${selectedPeopleNames.length > 1 ? 'les fillots ou fillottes' : 'le fillot/fillotte'} de ${hintAnchor}.`;

  const closeDialog = () => {
    setDialog(null);
    setAdminSection('families');
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
      setAdminSection('families');
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

  const handleDeleteStudent = async (studentId, fromShortcut = false) => {
    if (busy || deleteInProgressRef.current) return;
    const student = data.nodes.find((node) => node.id === studentId);
    if (!student) {
      setError('Cet étudiant n’est plus dans le graphe.');
      if (fromShortcut) setDialog('admin');
      return;
    }
    const linkedCount = data.links.filter((link) =>
      endpointId(link.source) === student.id || endpointId(link.target) === student.id
    ).length;

    deleteInProgressRef.current = true;
    const confirmed = window.confirm(
      `Supprimer ${student.name} et ses ${linkedCount} lien${linkedCount === 1 ? '' : 's'} familiaux ? Cette action est définitive.`
    );
    if (!confirmed) {
      deleteInProgressRef.current = false;
      return;
    }

    const nextData = {
      nodes: data.nodes.filter((node) => node.id !== student.id),
      links: data.links.filter((link) =>
        endpointId(link.source) !== student.id && endpointId(link.target) !== student.id
      ),
    };
    const csv = serializeStudentsCsv(nextData);
    const parsed = parseStudentsCsv(csv);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updatedSession = await saveSharedCsv(csv, session);
      setSession(updatedSession);
      onSaved(nextData, parsed.warnings);
      setMessage(`${student.name} et ses ${linkedCount} lien${linkedCount === 1 ? '' : 's'} familiaux ont été supprimés.`);
    } catch (saveError) {
      setError(`La suppression a échoué : ${saveError.message}`);
      if (fromShortcut) {
        setAnchorId(student.id);
        setRelationAction('delete');
        setDialog('admin');
      }
    } finally {
      setBusy(false);
      deleteInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (!deleteRequest || handledDeleteRef.current === deleteRequest.id || restoring) return;
    handledDeleteRef.current = deleteRequest.id;
    onDeleteHandled?.(deleteRequest.id);
    if (!session) {
      setError('Connecte-toi comme superadmin pour supprimer un étudiant.');
      setDialog('login');
      return;
    }
    void handleDeleteStudent(deleteRequest.studentId, true);
  }, [deleteRequest, restoring, session, handleDeleteStudent, onDeleteHandled]);

  if (!isSupabaseConfigured()) return null;

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

    if (relationAction === 'delete') {
      await handleDeleteStudent(anchorId);
      return;
    }

    if (relationAction === 'edit') {
      const student = data.nodes.find((node) => node.id === anchorId);
      if (!student) return setError('Choisis un étudiant à modifier.');
      const name = editName.trim().replace(/\s+/g, ' ');
      const year = Number(editPromo);
      if (!name) return setError('Saisis le nom de l’étudiant.');
      if (!Number.isInteger(year) || year < 1900 || year > currentPromoYear) {
        return setError(`Choisis une année de promo comprise entre 1900 et ${currentPromoYear}.`);
      }
      const normalized = normalizeName(name);
      if (data.nodes.some((node) => node.id !== student.id && normalizeName(node.name) === normalized)) {
        return setError('Une autre personne porte déjà ce nom.');
      }

      const updatedStudent = {
        ...student,
        name,
        promo: year,
        code: editCode.trim() || undefined,
        additionalAffiliations: parseAdditionalAffiliations(editAdditionalAffiliations),
        filiere: editFiliere.trim() || undefined,
        bio: editBio.trim() || undefined,
      };
      const nextData = {
        nodes: data.nodes.map((node) => node.id === student.id ? updatedStudent : node),
        links: data.links,
      };
      const csv = serializeStudentsCsv(nextData);
      const parsed = parseStudentsCsv(csv);
      setBusy(true);
      try {
        const updatedSession = await saveSharedCsv(csv, session);
        setSession(updatedSession);
        onSaved(nextData, parsed.warnings);
        setMessage(`Les informations de ${updatedStudent.name} ont été mises à jour.`);
      } catch (saveError) {
        setError(`La modification a échoué : ${saveError.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    const createStandalone = relationAction === 'create';
    const createNewPerson = createStandalone || (relationAction === 'add' && personType === 'new');
    const anchor = createStandalone ? null : data.nodes.find((node) => node.id === anchorId);
    if (!createStandalone && !anchor) return setError('Choisis un étudiant de référence.');

    const nextNodes = [...data.nodes];
    let people = [];
    if (createNewPerson) {
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
      const person = {
        id: `admin-${unique}`,
        name,
        promo: year,
        code: newCode.trim() || undefined,
        filiere: newFiliere.trim() || undefined,
      };
      people = [person];
      nextNodes.push(person);
    } else if (relationAction === 'add') {
      people = data.nodes.filter((node) => selectedIds.includes(node.id));
    } else {
      const person = data.nodes.find((node) => node.id === existingId);
      if (person) people = [person];
    }
    if (!people.length) {
      return setError(createStandalone
        ? 'Renseigne les informations de la personne.'
        : relationAction === 'add' ? 'Sélectionne au moins une personne à relier.' : 'Choisis la personne à relier.');
    }

    let nextLinks = [...data.links];
    if (!createStandalone) {
      if (people.some((person) => person.id === anchor.id)) return setError('Un étudiant ne peut pas être son propre parrain ou fillot.');
      if (relationAction === 'remove' && !removablePeople.some((candidate) => candidate.id === people[0].id)) {
        return setError('Choisis un lien existant à supprimer.');
      }

      const linksToAdd = people.map((person) => ({
        source: relationType === 'parrain' ? person.id : anchor.id,
        target: relationType === 'parrain' ? anchor.id : person.id,
      }));
      const duplicatePeople = relationAction === 'add'
        ? people.filter((person, index) => data.links.some((link) =>
          endpointId(link.source) === linksToAdd[index].source && endpointId(link.target) === linksToAdd[index].target
        ))
        : [];
      if (duplicatePeople.length) {
        return setError(`Un lien existe déjà pour : ${duplicatePeople.map((person) => person.name).join(', ')}.`);
      }

      if (relationAction === 'remove') {
        const { source, target } = linksToAdd[0];
        const exists = data.links.some((link) => endpointId(link.source) === source && endpointId(link.target) === target);
        if (!exists) return setError('Ce lien n’existe plus. Recharge les données puis réessaie.');
        nextLinks = data.links.filter((link) => endpointId(link.source) !== source || endpointId(link.target) !== target);
      } else {
        nextLinks = [...data.links, ...linksToAdd];
      }
    }

    const nextData = { nodes: nextNodes, links: nextLinks };
    const csv = serializeStudentsCsv(nextData);
    const parsed = parseStudentsCsv(csv);
    setBusy(true);
    try {
      const updatedSession = await saveSharedCsv(csv, session);
      setSession(updatedSession);
      // Garder les identifiants React et graphe en place après la sauvegarde.
      onSaved(nextData, parsed.warnings);
      setMessage(createStandalone
        ? `${people[0].name} a été ajouté·e au graphe sans lien familial.`
        : relationAction === 'remove'
          ? `Le lien avec ${people[0].name} a été supprimé.`
          : `${people.length} personne${people.length > 1 ? 's ont été ajoutées' : ' a été ajoutée'} à la famille de ${anchor.name}.`);
      if (relationAction === 'add' && personType === 'existing') setSelectedIds([]);
      if (createNewPerson) {
        setNewFirstName('');
        setNewLastName('');
        setNewCode('');
        setNewFiliere('');
        if (!createStandalone) setPersonType('existing');
      }
    } catch (saveError) {
      setError(`La sauvegarde a échoué : ${saveError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleValidateFamilyLinkRequest = async (request, activeSession) => {
    const child = data.nodes.find((node) => node.id === request.child_id);
    const parent = data.nodes.find((node) => node.id === request.parent_id);
    if (!child || !parent) {
      throw new Error('Un des étudiants de cette proposition n’existe plus dans le graphe.');
    }
    if (child.id === parent.id) {
      throw new Error('Un étudiant ne peut pas être son propre parrain ou sa propre marraine.');
    }

    const linkAlreadyExists = data.links.some((link) =>
      endpointId(link.source) === parent.id && endpointId(link.target) === child.id
    );
    if (linkAlreadyExists) return { session: activeSession };

    if (wouldCreateFamilyCycle(data.links, parent.id, child.id)) {
      throw new Error('Ce lien créerait une boucle dans le graphe ; la proposition reste à traiter.');
    }

    const nextData = {
      nodes: data.nodes,
      links: [...data.links, { source: parent.id, target: child.id }],
    };
    const csv = serializeStudentsCsv(nextData);
    const parsed = parseStudentsCsv(csv);
    setBusy(true);
    try {
      const updatedSession = await saveSharedCsv(csv, activeSession);
      setSession(updatedSession);
      onSaved(nextData, parsed.warnings);
      return { session: updatedSession };
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
                  <p className="admin-panel__eyebrow">Superadmin <BrandDivider /> {session?.user?.email}</p>
                  <h2 id="admin-title">{adminSection === 'requests' ? 'Propositions de liens' : 'Gestion des familles'}</h2>
                </div>
                <div className="admin-panel__actions">
                  <button
                    type="button"
                    className="admin-panel__logout"
                    aria-pressed={adminSection === 'requests'}
                    onClick={() => setAdminSection((section) => section === 'requests' ? 'families' : 'requests')}
                    disabled={busy}
                  >
                    {adminSection === 'requests' ? 'Familles' : 'Requêtes'}
                  </button>
                  <button type="button" className="admin-panel__logout" onClick={handleLogout} disabled={busy}>Déconnexion</button>
                  <button type="button" className="admin-panel__close" onClick={closeDialog} aria-label="Fermer">×</button>
                </div>
              </header>

              {adminSection === 'requests' ? (
                <FamilyLinkRequestInbox
                  session={session}
                  onSession={setSession}
                  onValidate={handleValidateFamilyLinkRequest}
                />
              ) : (
              <form className="admin-form" onSubmit={handleSave}>
                {relationAction !== 'create' && (
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
                )}

                <div className="admin-field">
                  <span className="admin-field__label">Action dans le graphe</span>
                  <div className="admin-tabs admin-tabs--compact" role="tablist" aria-label="Action sur le graphe">
                    <button type="button" role="tab" aria-selected={relationAction === 'add'} className={relationAction === 'add' ? 'is-active' : ''} onClick={() => setRelationAction('add')}>
                      Ajouter un lien
                    </button>
                    <button type="button" role="tab" aria-selected={relationAction === 'remove'} className={relationAction === 'remove' ? 'is-active' : ''} onClick={() => setRelationAction('remove')}>
                      Supprimer un lien
                    </button>
                    <button type="button" role="tab" aria-selected={relationAction === 'create'} className={relationAction === 'create' ? 'is-active' : ''} onClick={() => setRelationAction('create')}>
                      Créer un étudiant
                    </button>
                    <button type="button" role="tab" aria-selected={relationAction === 'edit'} className={relationAction === 'edit' ? 'is-active' : ''} onClick={() => setRelationAction('edit')}>
                      Modifier un étudiant
                    </button>
                    <button type="button" role="tab" aria-selected={relationAction === 'delete'} className={`admin-tabs__delete${relationAction === 'delete' ? ' is-active' : ''}`} onClick={() => setRelationAction('delete')}>
                      Supprimer un étudiant
                    </button>
                  </div>
                </div>

                {(relationAction === 'add' || relationAction === 'remove') && (
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
                )}

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

                {relationAction === 'create' && (
                  <span className="admin-field__label">Nouvelle personne sans lien familial</span>
                )}

                {relationAction === 'edit' && (
                  <div className="admin-form__new-person">
                    <label>
                      Nom complet
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} required />
                    </label>
                    <div className="admin-form__row">
                      <div className="admin-field">
                        <span className="admin-field__label">Année de promo</span>
                        <ChoiceSelect
                          id="edit-student-year"
                          label="Année de promo"
                          options={editPromoOptions}
                          value={editPromo}
                          onChange={setEditPromo}
                          searchPlaceholder="Rechercher une année"
                        />
                      </div>
                      <div className="admin-field">
                        <span className="admin-field__label">Code</span>
                        <ChoiceSelect
                          id="edit-student-code"
                          label="Code"
                          options={editCodeOptions}
                          value={editCode}
                          onChange={setEditCode}
                          searchPlaceholder="Rechercher un code"
                        />
                      </div>
                    </div>
                    <div className="admin-field">
                      <span className="admin-field__label">Filière</span>
                      <ChoiceSelect
                        id="edit-student-filiere"
                        label="Filière"
                        options={editFiliereOptions}
                        value={editFiliere}
                        onChange={setEditFiliere}
                        searchPlaceholder="Rechercher une filière"
                      />
                    </div>
                    <label>
                      Appartenances secondaires
                      <input
                        value={editAdditionalAffiliations}
                        onChange={(event) => setEditAdditionalAffiliations(event.target.value)}
                        placeholder="Ex. LG23 ; LG21"
                      />
                      <small>Codes séparés par des points-virgules. La promo la plus récente reste la position principale.</small>
                    </label>
                    <label>
                      Bio / description
                      <textarea rows="3" value={editBio} onChange={(event) => setEditBio(event.target.value)} />
                    </label>
                  </div>
                )}

                {relationAction === 'remove' ? (
                  <div className="admin-selection">
                    <span className="admin-selection__title">Personne liée</span>
                    <StudentSelect
                      id="related-student"
                      label="Personne liée"
                      students={selectablePeople}
                      value={existingId}
                      onChange={setExistingId}
                      disabled={!selectablePeople.length}
                      emptyLabel="Aucun lien de ce type pour cet étudiant"
                    />
                  </div>
                ) : relationAction === 'add' && personType === 'existing' ? (
                  <div className="admin-selection">
                    <span className="admin-selection__title">Personnes à ajouter</span>
                    <StudentMultiSelect
                      id="related-students"
                      label="Personnes à ajouter"
                      students={availableExisting}
                      selectedIds={selectedIds}
                      onChange={setSelectedIds}
                      emptyLabel="Sélectionner une ou plusieurs personnes"
                    />
                  </div>
                ) : relationAction === 'add' || relationAction === 'create' ? (
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
                      <div className="admin-field">
                        <span className="admin-field__label">Année d’arrivée</span>
                        <ChoiceSelect
                          id="new-person-year"
                          label="Année d’arrivée"
                          options={promoOptions}
                          value={newPromo}
                          onChange={setNewPromo}
                          searchPlaceholder="Rechercher une année"
                        />
                      </div>
                      <div className="admin-field">
                        <span className="admin-field__label">Code</span>
                        <ChoiceSelect
                          id="new-person-code"
                          label="Code"
                          options={CODE_OPTIONS}
                          value={newCode}
                          onChange={setNewCode}
                          searchPlaceholder="Rechercher un code"
                        />
                      </div>
                    </div>
                    <div className="admin-field">
                      <span className="admin-field__label">Filière</span>
                      <ChoiceSelect
                        id="new-person-filiere"
                        label="Filière"
                        options={FILIERE_OPTIONS}
                        value={newFiliere}
                        onChange={setNewFiliere}
                        searchPlaceholder="Rechercher une filière"
                      />
                    </div>
                  </div>
                ) : null}

                <p className="admin-form__hint">
                  {relationAction === 'delete'
                    ? `La fiche de ${hintAnchor} et ses ${anchorLinksCount} lien${anchorLinksCount === 1 ? '' : 's'} familiaux seront supprimés ensemble. Depuis le graphe, Maj+Suppr supprime directement l’étudiant sélectionné.`
                    : relationAction === 'create'
                      ? 'La personne sera ajoutée au graphe sans lien familial.'
                      : relationAction === 'edit'
                        ? 'Les liens familiaux de cet étudiant seront conservés.'
                        : relationAction === 'remove'
                          ? `Seuls les ${relationType === 'parrain' ? 'parrains et marraines' : 'fillots et fillottes'} déjà liés à cet étudiant sont proposés.`
                          : relationAction === 'add' && personType === 'existing' ? selectedRelationshipHint : relationshipHint}
                </p>
                {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
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
                  <button
                    type="button"
                    className="admin-panel__logout"
                    data-tooltip="Importer un nouveau fichier Excel de référence"
                    aria-label="Importer un nouveau fichier Excel de référence"
                    onClick={() => workbookInputRef.current?.click()}
                    disabled={busy}
                  >
                    {busy ? 'Import…' : 'Importer'}
                  </button>
                  <button type="button" className="admin-panel__logout" data-tooltip="Télécharger le fichier actuel" aria-label="Télécharger le fichier actuel" onClick={handleCreateBase} disabled={busy || !data.nodes.length}>
                    {busy ? 'Téléchargement…' : 'Télécharger'}
                  </button>
                  <button className={`btn admin-submit${relationAction === 'delete' ? ' admin-submit--danger' : ''}`} type="submit" disabled={busy || (relationAction !== 'create' && !data.nodes.length) || (relationAction === 'remove' ? !selectablePeople.some((student) => student.id === existingId) : relationAction === 'add' && personType === 'existing' && !selectedIds.length)}>
                    {busy ? 'Enregistrement…' : relationAction === 'delete' ? 'Supprimer' : 'Enregistrer'}
                  </button>
                </footer>
              </form>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
