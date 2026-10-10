import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { managePlayerAccounts } from '../lib/supabase';
import { accountErrorMessage } from '../lib/playerAccounts';

const EMPTY_PROFILE = {
  firstName: '',
  lastName: '',
  pseudo: '',
  arrivalYear: '',
  programCode: '',
  filiere: '',
  bio: '',
};

const PROGRAM_CODES = ['ING', 'LG', 'M'];
const FILIERES = ['Carthagéo', 'IGAST', 'TSI', 'PPMD', 'GDS', 'DDMEG', 'GDM', 'Double diplôme', 'FRS', 'FIRS'];
const accountListCache = new Map();

function normalizeChoice(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim();
}

function PlayerAdminChoiceSelect({ id, label, options, value, onChange }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalizeChoice(query);
  const filteredOptions = useMemo(() => options.filter((option) => normalizeChoice(option.label).includes(normalizedQuery)), [options, normalizedQuery]);
  const selectedOption = options.find((option) => option.value === value);
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
  }, [open, value]);

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

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredOptions.length) setActiveIndex((index) => (index + 1) % filteredOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredOptions.length) setActiveIndex((index) => (index - 1 + filteredOptions.length) % filteredOptions.length);
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
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="admin-student-select__label">
          <span className="admin-student-select__name">{selectedOption?.label ?? options[0]?.label}</span>
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
            placeholder={`Rechercher ${label.toLocaleLowerCase('fr')}`}
            aria-label={`Rechercher ${label.toLocaleLowerCase('fr')}`}
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
                key={option.value || 'empty'}
                className={`admin-student-select__option${option.value === value ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="admin-student-select__label"><span className="admin-student-select__name">{option.label}</span></span>
              </div>
            )) : <p className="admin-student-select__empty">Aucun résultat</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function profileFromAccount(account) {
  return {
    ...EMPTY_PROFILE,
    ...account.profile,
    arrivalYear: account.profile?.arrivalYear ? String(account.profile.arrivalYear) : '',
  };
}

function emailFailureMessage(action, issue) {
  const details = {
    missing_configuration: 'Le SMTP Orange n’est pas entièrement configuré dans les secrets de la fonction Supabase.',
    smtp_authentication: 'Orange a refusé l’identifiant ou le mot de passe SMTP. Vérifie les secrets de la fonction.',
    smtp_connection: 'La fonction n’a pas réussi à joindre le serveur SMTP Orange. Réessaie plus tard.',
    smtp_rejected: 'Le serveur SMTP Orange a refusé l’envoi. Vérifie l’adresse du destinataire et les réglages SMTP.',
  };
  return `${action}, mais l’e-mail n’a pas été envoyé. ${details[issue] ?? details.smtp_rejected}`;
}

export default function PlayerAccountAdminPanel({ session, onSession }) {
  const cachedAccounts = accountListCache.get(session?.user?.id);
  const [accounts, setAccounts] = useState(cachedAccounts ?? []);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!cachedAccounts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const accountYears = useMemo(() => Array.from(
    { length: Math.max(0, new Date().getFullYear() + 1 - 1950 + 1) },
    (_, index) => String(new Date().getFullYear() + 1 - index),
  ), []);
  const yearOptions = useMemo(() => [
    { value: '', label: 'Choisir une année' },
    ...accountYears.map((year) => ({ value: year, label: year })),
  ], [accountYears]);
  const codeOptions = useMemo(() => [
    { value: '', label: 'Choisir un code' },
    ...PROGRAM_CODES.map((code) => ({ value: code, label: code })),
  ], []);
  const filiereOptions = useMemo(() => {
    const options = [
      { value: '', label: 'Aucune filière' },
      ...FILIERES.map((filiere) => ({ value: filiere, label: filiere })),
    ];
    if (draft.filiere && !FILIERES.includes(draft.filiere)) {
      options.push({ value: draft.filiere, label: draft.filiere });
    }
    return options;
  }, [draft.filiere]);
  const selectedAccount = accounts.find((account) => account.userId === selectedUserId) ?? null;
  const filteredAccounts = accounts.filter((account) => {
    const haystack = [account.email, account.profile?.firstName, account.profile?.lastName, account.profile?.pseudo]
      .filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    const needle = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
    return haystack.includes(needle);
  });

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => setMessage(''), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const request = async (action, payload = {}) => {
    const result = await managePlayerAccounts(action, payload, session);
    onSession?.(result.session);
    return result;
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await request('list');
      const nextAccounts = result.accounts ?? [];
      accountListCache.set(session?.user?.id, nextAccounts);
      setAccounts(nextAccounts);
    } catch (loadError) {
      setError(accountErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountListCache.has(session?.user?.id)) return;
    void refresh();
    // The current session is refreshed by request() and retained by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const openAccount = (account) => {
    setSelectedUserId((current) => current === account.userId ? '' : account.userId);
    setDraft(profileFromAccount(account));
    setDeleteConfirmation(false);
    setError('');
    setMessage('');
  };

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!selectedAccount) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request('update', {
        userId: selectedAccount.userId,
        profile: { ...draft, arrivalYear: Number(draft.arrivalYear) },
      });
      setMessage(result.emailSent
        ? 'Profil enregistré. Un e-mail a été envoyé à la personne.'
        : emailFailureMessage('Le profil est enregistré', result.emailIssue));
      const updatedAccounts = accounts.map((account) => account.userId === selectedAccount.userId
        ? { ...account, profile: { ...draft, arrivalYear: Number(draft.arrivalYear) }, hasProfile: true }
        : account);
      accountListCache.set(session?.user?.id, updatedAccounts);
      setAccounts(updatedAccounts);
    } catch (saveError) {
      setError(accountErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!selectedAccount) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request('delete', { userId: selectedAccount.userId });
      setSelectedUserId('');
      setDeleteConfirmation(false);
      setMessage(result.emailSent
        ? 'Compte supprimé. Un e-mail a été envoyé à la personne.'
        : emailFailureMessage('Compte supprimé', result.emailIssue));
      const remainingAccounts = accounts.filter((account) => account.userId !== selectedAccount.userId);
      accountListCache.set(session?.user?.id, remainingAccounts);
      setAccounts(remainingAccounts);
    } catch (deleteError) {
      setError(accountErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="player-admin" aria-label="Gestion des comptes joueurs">
      <header className="player-admin__header">
        <p>Comptes joueurs <span>{accounts.length}</span></p>
        <button type="button" className="player-admin__refresh" onClick={refresh} disabled={loading || busy} aria-label="Actualiser les comptes" title="Actualiser">
          <RefreshCw size={17} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <p className="player-admin__intro">Modifie les profils ou supprime un compte. La personne concernée reçoit un e-mail après chaque action.</p>
      <label className="player-admin__search">
        <span className="sr-only">Rechercher un compte</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher par nom, pseudo ou e-mail" />
      </label>
      {error && <p className="player-admin__message player-admin__message--error" role="alert">{error}</p>}
      {message && <p className="player-admin__message" role="status">{message}</p>}
      {loading ? <p className="player-admin__empty" role="status">Chargement des comptes…</p> : (
        <div className="player-admin__accounts">
          {filteredAccounts.length ? filteredAccounts.map((account) => {
            const active = selectedUserId === account.userId;
            const profileName = [account.profile?.firstName, account.profile?.lastName].filter(Boolean).join(' ');
            return (
              <article className={'player-admin__account' + (active ? ' is-open' : '')} key={account.userId}>
                <button type="button" className="player-admin__account-trigger" aria-expanded={active} onClick={() => openAccount(account)}>
                  <span className="player-admin__account-main">
                    <strong>{account.profile?.pseudo || profileName || 'Profil incomplet'}</strong>
                    <span>{account.email}</span>
                  </span>
                  <span className="player-admin__account-meta">
                    <span>{profileName || 'Profil à compléter'}</span>
                    <small>{account.isSuperadmin ? 'Compte superadmin' : account.emailConfirmed ? 'E-mail confirmé' : 'En attente de confirmation'}</small>
                  </span>
                  <span className="player-admin__account-chevron" aria-hidden="true">{active ? '−' : '+'}</span>
                </button>
                {active && (
                  <form className="player-admin__form" onSubmit={saveProfile}>
                    {!account.hasProfile && <p className="player-admin__notice">Ce compte n’a pas encore de profil complet.</p>}
                    <div className="player-admin__fields">
                      <label><span>Prénom</span><input required maxLength={80} value={draft.firstName} onChange={(event) => updateDraft('firstName', event.target.value)} /></label>
                      <label><span>Nom</span><input required maxLength={80} value={draft.lastName} onChange={(event) => updateDraft('lastName', event.target.value)} /></label>
                      <label><span>Pseudo</span><input required minLength={2} maxLength={32} value={draft.pseudo} onChange={(event) => updateDraft('pseudo', event.target.value)} /></label>
                      <div className="player-admin__field">
                        <span>Année d’arrivée</span>
                        <PlayerAdminChoiceSelect
                          id={`player-admin-year-${account.userId}`}
                          label="Année d’arrivée"
                          options={yearOptions}
                          value={draft.arrivalYear}
                          onChange={(value) => updateDraft('arrivalYear', value)}
                        />
                      </div>
                      <div className="player-admin__field">
                        <span>Code</span>
                        <PlayerAdminChoiceSelect
                          id={`player-admin-code-${account.userId}`}
                          label="Code"
                          options={codeOptions}
                          value={draft.programCode}
                          onChange={(value) => updateDraft('programCode', value)}
                        />
                      </div>
                      <div className="player-admin__field">
                        <span>Filière <small>(facultative)</small></span>
                        <PlayerAdminChoiceSelect
                          id={`player-admin-filiere-${account.userId}`}
                          label="Filière"
                          options={filiereOptions}
                          value={draft.filiere}
                          onChange={(value) => updateDraft('filiere', value)}
                        />
                      </div>
                      <label className="player-admin__field--wide"><span>Bio <small>(facultative)</small></span><textarea rows="3" maxLength={280} value={draft.bio} onChange={(event) => updateDraft('bio', event.target.value)} /></label>
                    </div>
                    {deleteConfirmation ? (
                      <div className="player-admin__delete-confirm" role="group" aria-label="Confirmer la suppression du compte">
                        <p>Supprimer définitivement ce compte, son profil et ses statistiques ? Un e-mail sera envoyé à {account.email}.</p>
                        <button type="button" onClick={() => setDeleteConfirmation(false)} disabled={busy}>Annuler</button>
                        <button type="button" className="is-danger" onClick={deleteAccount} disabled={busy}>{busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
                      </div>
                    ) : (
                      <footer className="player-admin__form-actions">
                        <button type="button" className="is-danger" onClick={() => setDeleteConfirmation(true)} disabled={busy || account.isSuperadmin} title={account.isSuperadmin ? 'Un compte superadmin ne peut pas être supprimé ici.' : undefined}>
                          <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" /> Supprimer le compte
                        </button>
                        <button type="submit" disabled={busy}>
                          <Save size={15} strokeWidth={1.8} aria-hidden="true" /> {busy ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                      </footer>
                    )}
                  </form>
                )}
              </article>
            );
          }) : <p className="player-admin__empty">{query ? 'Aucun compte ne correspond à cette recherche.' : 'Aucun compte joueur.'}</p>}
        </div>
      )}
    </section>
  );
}
