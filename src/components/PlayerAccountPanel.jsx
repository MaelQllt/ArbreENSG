import { useEffect, useMemo, useRef, useState } from 'react';
import {
  accountErrorMessage,
  checkPlayerPseudoAvailability,
  getPlayerChallengeStats,
  getPlayerAccountRedirectUrl,
  MIN_PASSWORD_LENGTH,
  profileFromAuthMetadata,
  savePlayerProfile,
  validatePlayerProfile,
} from '../lib/playerAccounts';
import { getAccountAuthClient, isSupabaseConfigured } from '../lib/supabase';
import BrandDivider from './BrandDivider';
import PasswordInput from './PasswordInput';

const EMPTY_PROFILE = Object.freeze({
  firstName: '',
  lastName: '',
  pseudo: '',
  arrivalYear: '',
  programCode: '',
  filiere: '',
  bio: '',
});

const PROGRAM_OPTIONS = [
  { value: '', label: 'Choisir un code' },
  ...['ING', 'LG', 'M'].map((code) => ({ value: code, label: code })),
];

const FILIERE_OPTIONS = [
  { value: '', label: 'Aucune filière' },
  ...['Carthagéo', 'IGAST', 'TSI', 'PPMD', 'GDS', 'DDMEG', 'GDM', 'Double diplôme', 'FRS', 'FIRS']
    .map((filiere) => ({ value: filiere, label: filiere })),
];

let playerAccountSnapshot = null;
let playerProfileRequest = null;

function profileDraftFromRow(data) {
  return {
    firstName: data.first_name,
    lastName: data.last_name,
    pseudo: data.pseudo,
    arrivalYear: String(data.arrival_year),
    programCode: data.program_code,
    filiere: data.filiere ?? '',
    bio: data.bio ?? '',
  };
}

export function updatePlayerAccountStatsCache(userId, stats) {
  if (playerAccountSnapshot?.user?.id === userId) {
    playerAccountSnapshot = { ...playerAccountSnapshot, stats };
  }
}

function getCurrentArrivalYear(date) {
  return date.getFullYear() - (date.getMonth() < 8 ? 1 : 0);
}

function ProfileChoiceSelect({ id, label, options, value, onChange }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
  const filteredOptions = options.filter((option) => option.label
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').includes(normalizedQuery));
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
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
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

function Field({ id, label, ...props }) {
  const { type, ...inputProps } = props;
  return (
    <label className="player-account__field" htmlFor={id}>
      <span>{label}</span>
      {type === 'password'
        ? <PasswordInput id={id} {...inputProps} />
        : <input id={id} type={type} {...inputProps} />}
    </label>
  );
}

export default function PlayerAccountPanel({
  initialMode = 'login',
  onTransientStatus,
  onConnectionChange,
  onAuthReady,
  knownAuthReady = false,
  knownUser = null,
}) {
  const cachedSnapshot = knownUser?.id && playerAccountSnapshot?.user?.id === knownUser.id
    ? playerAccountSnapshot
    : null;
  const [mode, setMode] = useState(() => (
    initialMode === 'recovery'
      ? 'recovery'
      : cachedSnapshot
        ? (cachedSnapshot.profile ? 'profile' : 'complete-profile')
        : initialMode
  ));
  const [authReady, setAuthReady] = useState(() => Boolean(knownAuthReady && (!knownUser || cachedSnapshot)));
  const [user, setUser] = useState(knownUser ?? cachedSnapshot?.user ?? null);
  const [profile, setProfile] = useState(cachedSnapshot?.profile ?? null);
  const [profileDraft, setProfileDraft] = useState(cachedSnapshot?.profileDraft ?? EMPTY_PROFILE);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [stats, setStats] = useState(cachedSnapshot?.stats ?? { daily: 0, weekly: 0, points: 0 });
  const [statsUnavailable, setStatsUnavailable] = useState(cachedSnapshot?.statsUnavailable ?? false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const clientRef = useRef(null);
  const initialAuthCheckRef = useRef(false);
  const profileEditorTimerRef = useRef(null);
  const profileEditButtonRef = useRef(null);
  const currentArrivalYear = getCurrentArrivalYear(new Date());
  const arrivalYearOptions = useMemo(() => [
    { value: '', label: 'Choisir une année' },
    ...Array.from({ length: Math.max(0, currentArrivalYear - 1999) }, (_, index) => {
      const year = String(currentArrivalYear - index);
      return { value: year, label: year };
    }),
  ], [currentArrivalYear]);

  useEffect(() => {
    if (initialMode === 'recovery' || initialMode === 'confirmed') setMode(initialMode);
  }, [initialMode]);

  useEffect(() => () => window.clearTimeout(profileEditorTimerRef.current), []);

  useEffect(() => {
    initialAuthCheckRef.current = knownAuthReady;
    if (!knownAuthReady) setAuthReady(false);
    const markAuthReady = () => {
      setAuthReady(true);
      onAuthReady?.();
    };
    if (!isSupabaseConfigured()) {
      markAuthReady();
      return undefined;
    }

    let mounted = true;
    let subscription;

    const connect = async () => {
      let client;
      try {
        client = await getAccountAuthClient();
        if (!mounted) return;
        clientRef.current = client;
      } catch (authError) {
        if (mounted) {
          setError(accountErrorMessage(authError));
          initialAuthCheckRef.current = true;
          markAuthReady();
        }
        return;
      }

      const loadProfile = async (session) => {
        if (!session?.user) return;
        const authUser = session.user;
        if (mounted) {
          setUser(authUser);
          onConnectionChange?.(true);
        }

        const loadStats = async () => {
          try {
            const nextStats = await getPlayerChallengeStats();
            if (mounted) {
              setStats(nextStats);
              setStatsUnavailable(false);
            }
            if (playerAccountSnapshot?.user?.id === authUser.id) {
              playerAccountSnapshot = { ...playerAccountSnapshot, stats: nextStats, statsUnavailable: false };
            }
          } catch {
            if (mounted) setStatsUnavailable(true);
            if (playerAccountSnapshot?.user?.id === authUser.id) {
              playerAccountSnapshot = { ...playerAccountSnapshot, statsUnavailable: true };
            }
          }
        };

        const applySnapshot = (snapshot) => {
          playerAccountSnapshot = snapshot;
          if (!mounted) return;
          setProfile(snapshot.profile);
          setProfileDraft(snapshot.profileDraft ?? EMPTY_PROFILE);
          setStats(snapshot.stats ?? { daily: 0, weekly: 0, points: 0 });
          setStatsUnavailable(Boolean(snapshot.statsUnavailable));
          if (initialMode !== 'recovery') {
            setMode(snapshot.profile ? 'profile' : 'complete-profile');
          }
        };

        const existingRequest = playerProfileRequest?.userId === authUser.id
          ? playerProfileRequest.promise
          : null;
        if (existingRequest) {
          try {
            const snapshot = await existingRequest;
            applySnapshot(snapshot);
            if (snapshot.profile) void loadStats();
          } catch (loadError) {
            if (mounted) {
              setError(accountErrorMessage(loadError));
              if (initialMode !== 'recovery') setMode('complete-profile');
            }
          }
          return;
        }

        const promise = (async () => {
          const { data, error: selectError } = await client
            .from('player_profiles')
            .select('user_id, first_name, last_name, pseudo, arrival_year, program_code, filiere, bio')
            .eq('user_id', authUser.id)
            .maybeSingle();
          if (selectError) throw selectError;

          let nextProfile = data;
          let nextDraft = data
            ? profileDraftFromRow(data)
            : profileFromAuthMetadata(authUser.user_metadata);
          if (!data && !validatePlayerProfile(nextDraft)) {
            nextProfile = await savePlayerProfile(authUser.id, nextDraft);
            nextDraft = profileDraftFromRow(nextProfile);
          }

          const previousSnapshot = playerAccountSnapshot?.user?.id === authUser.id
            ? playerAccountSnapshot
            : null;
          return {
            user: authUser,
            profile: nextProfile,
            profileDraft: nextDraft,
            stats: previousSnapshot?.stats ?? { daily: 0, weekly: 0, points: 0 },
            statsUnavailable: previousSnapshot?.statsUnavailable ?? false,
          };
        })();
        playerProfileRequest = { userId: authUser.id, promise };
        try {
          const snapshot = await promise;
          applySnapshot(snapshot);
          if (snapshot.profile) void loadStats();
        } catch (loadError) {
          if (mounted) {
            setError(accountErrorMessage(loadError));
            if (initialMode !== 'recovery') setMode('complete-profile');
          }
        } finally {
          if (playerProfileRequest?.promise === promise) playerProfileRequest = null;
        }
      };

      const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
        if (knownAuthReady && event === 'INITIAL_SESSION') return;
        if (event === 'PASSWORD_RECOVERY') {
          setMode('recovery');
          setStatus('Choisis un nouveau mot de passe pour ton compte.');
          if (initialAuthCheckRef.current) markAuthReady();
          return;
        }
        if (session) {
          if (initialAuthCheckRef.current && ['INITIAL_SESSION', 'SIGNED_IN'].includes(event)) {
            setAuthReady(false);
          }
          Promise.resolve()
            .then(() => loadProfile(session))
            .catch((loadError) => {
              if (mounted) setError(accountErrorMessage(loadError));
            })
            .finally(() => {
              if (mounted && initialAuthCheckRef.current) markAuthReady();
            });
        } else if (event === 'SIGNED_OUT') {
          playerAccountSnapshot = null;
          setUser(null);
          setProfile(null);
          setProfileDraft(EMPTY_PROFILE);
          setEditingProfile(false);
          setProfileEditorVisible(false);
          window.clearTimeout(profileEditorTimerRef.current);
          setStats({ daily: 0, weekly: 0, points: 0 });
          onConnectionChange?.(false);
          setMode('login');
          if (initialAuthCheckRef.current) markAuthReady();
        }
      });
      subscription = authListener.subscription;

      if (knownAuthReady) {
        initialAuthCheckRef.current = true;
        if (knownUser) {
          setUser(knownUser);
          onConnectionChange?.(true);
          const snapshot = playerAccountSnapshot?.user?.id === knownUser.id ? playerAccountSnapshot : null;
          if (snapshot) {
            setProfile(snapshot.profile);
            setProfileDraft(snapshot.profileDraft ?? EMPTY_PROFILE);
            setStats(snapshot.stats ?? { daily: 0, weekly: 0, points: 0 });
            setStatsUnavailable(Boolean(snapshot.statsUnavailable));
            if (initialMode !== 'recovery') setMode(snapshot.profile ? 'profile' : 'complete-profile');
          } else {
            setAuthReady(false);
            await loadProfile({ user: knownUser });
            if (initialMode === 'recovery') setMode('recovery');
          }
        } else {
          setUser(null);
          setProfile(null);
          setProfileDraft(EMPTY_PROFILE);
          onConnectionChange?.(false);
          setMode(initialMode);
        }
        markAuthReady();
        return;
      }

      try {
        const { data, error: sessionError } = await client.auth.getSession();
        if (!mounted) return;
        if (sessionError) setError(accountErrorMessage(sessionError));
        const session = data?.session;
        if (session) {
          await loadProfile(session);
          if (initialMode === 'recovery') setMode('recovery');
        } else if (initialMode === 'confirmed') {
          onConnectionChange?.(false);
          setMode('confirmed');
        } else {
          onConnectionChange?.(false);
        }
        initialAuthCheckRef.current = true;
        markAuthReady();

        // Supabase has now had the opportunity to exchange a confirmation or recovery code.
        // Keep the game route and remove only our temporary account marker.
        const url = new URL(window.location.href);
        if (url.searchParams.has('account')) {
          url.searchParams.delete('account');
          window.history.replaceState(window.history.state, '', url);
        }
      } catch (sessionError) {
        if (mounted) {
          setError(accountErrorMessage(sessionError));
          initialAuthCheckRef.current = true;
          markAuthReady();
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
      clientRef.current = null;
    };
  }, [initialMode, knownAuthReady, knownUser?.id]);

  const updateDraft = (key, value) => {
    setProfileDraft((current) => ({ ...current, [key]: value }));
  };

  const openProfileEditor = () => {
    window.clearTimeout(profileEditorTimerRef.current);
    setProfileEditorVisible(true);
    window.requestAnimationFrame(() => setEditingProfile(true));
  };

  const closeProfileEditor = () => {
    setEditingProfile(false);
    window.clearTimeout(profileEditorTimerRef.current);
    profileEditorTimerRef.current = window.setTimeout(() => setProfileEditorVisible(false), 260);
    profileEditButtonRef.current?.focus();
  };

  const ensureAccountClient = async () => {
    if (!clientRef.current) clientRef.current = await getAccountAuthClient();
    return clientRef.current;
  };

  const runAction = async (action) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (actionError) {
      setError(accountErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = (event) => {
    event.preventDefault();
    runAction(async () => {
      const client = await ensureAccountClient();
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    });
  };

  const submitSignUp = (event) => {
    event.preventDefault();
    runAction(async () => {
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      if (password !== passwordConfirmation) throw new Error('Les mots de passe ne correspondent pas.');
      const profileError = validatePlayerProfile(profileDraft);
      if (profileError) throw new Error(profileError);
      if (!await checkPlayerPseudoAvailability(profileDraft.pseudo)) throw new Error('Ce pseudo est déjà utilisé. Choisis-en un autre.');

      const client = await ensureAccountClient();
      const { data, error: authError } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: profileDraft.firstName.trim(),
            last_name: profileDraft.lastName.trim(),
            pseudo: profileDraft.pseudo.trim(),
            arrival_year: Number(profileDraft.arrivalYear),
            program_code: profileDraft.programCode,
            filiere: profileDraft.filiere,
            bio: profileDraft.bio.trim(),
          },
          emailRedirectTo: getPlayerAccountRedirectUrl('confirmed'),
        },
      });
      if (authError) throw authError;

      if (data.session && data.user) {
        const savedProfile = await savePlayerProfile(data.user.id, profileDraft);
        const savedDraft = profileDraftFromRow(savedProfile);
        setUser(data.user);
        setProfile(savedProfile);
        setProfileDraft(savedDraft);
        playerAccountSnapshot = {
          user: data.user,
          profile: savedProfile,
          profileDraft: savedDraft,
          stats: { daily: 0, weekly: 0, points: 0 },
          statsUnavailable: false,
        };
        setMode('profile');
        setStatus('Ton compte est créé. Bienvenue !');
        onConnectionChange?.(true);
      } else {
        setMode('check-email');
        setStatus('Compte créé. Consulte ta boîte e-mail pour confirmer ton adresse avant de te connecter.\n\nOuvre le lien de confirmation reçu par e-mail pour activer ton compte.');
      }
    });
  };

  const submitProfile = (event) => {
    event.preventDefault();
    runAction(async () => {
      const client = await ensureAccountClient();
      const { data: available, error: pseudoError } = await client.rpc('is_player_pseudo_available', {
        p_pseudo: profileDraft.pseudo.trim(),
      });
      if (pseudoError) throw pseudoError;
      const currentPseudo = profile?.pseudo?.toLowerCase();
      if (!available && currentPseudo !== profileDraft.pseudo.trim().toLowerCase()) {
        throw new Error('Ce pseudo est déjà utilisé. Choisis-en un autre.');
      }
      const savedProfile = await savePlayerProfile(user.id, profileDraft);
      setProfile(savedProfile);
      playerAccountSnapshot = {
        user,
        profile: savedProfile,
        profileDraft: profileDraftFromRow(savedProfile),
        stats,
        statsUnavailable,
      };
      closeProfileEditor();
      setMode('profile');
      setStatus('');
      onTransientStatus?.('Profil enregistré.');
    });
  };

  const submitForgotPassword = (event) => {
    event.preventDefault();
    runAction(async () => {
      const client = await ensureAccountClient();
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getPlayerAccountRedirectUrl('recovery'),
      });
      if (resetError) throw resetError;
      setStatus('Si un compte correspond à cette adresse, tu recevras un lien pour choisir un nouveau mot de passe.');
    });
  };

  const submitNewPassword = (event) => {
    event.preventDefault();
    runAction(async () => {
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      if (password !== passwordConfirmation) throw new Error('Les mots de passe ne correspondent pas.');
      const client = await ensureAccountClient();
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setPasswordConfirmation('');
      setMode('profile');
      setStatus('Mot de passe modifié.');
    });
  };

  const signOut = () => runAction(async () => {
    const client = await ensureAccountClient();
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    playerAccountSnapshot = null;
    setMode('login');
    onConnectionChange?.(false);
    onTransientStatus?.('Tu es déconnecté.');
  });

  if (!isSupabaseConfigured()) {
    return <p className="player-account__notice" role="status">Les comptes seront disponibles après configuration de Supabase.</p>;
  }

  if (!authReady) {
    return <p className="player-account__loading" role="status" aria-live="polite">{knownUser ? 'Chargement du profil…' : 'Chargement du compte…'}</p>;
  }

  const profileFields = (
    <div className="player-account__profile-grid">
      <Field id="player-first-name" label="Prénom" autoComplete="given-name" maxLength={80} required value={profileDraft.firstName} onChange={(event) => updateDraft('firstName', event.target.value)} />
      <Field id="player-last-name" label="Nom" autoComplete="family-name" maxLength={80} required value={profileDraft.lastName} onChange={(event) => updateDraft('lastName', event.target.value)} />
      <Field id="player-pseudo" label="Pseudo (affiché au classement)" autoComplete="nickname" maxLength={32} required value={profileDraft.pseudo} onChange={(event) => updateDraft('pseudo', event.target.value)} />
      <div className="player-account__field">
        <span>Année d’arrivée à l’école</span>
        <ProfileChoiceSelect
          id="player-arrival-year"
          label="Année d’arrivée"
          options={arrivalYearOptions.some((option) => option.value === String(profileDraft.arrivalYear))
            || !profileDraft.arrivalYear
            ? arrivalYearOptions
            : [...arrivalYearOptions, { value: String(profileDraft.arrivalYear), label: String(profileDraft.arrivalYear) }]}
          value={String(profileDraft.arrivalYear)}
          onChange={(value) => updateDraft('arrivalYear', value)}
        />
      </div>
      <div className="player-account__field">
        <span>Code</span>
        <ProfileChoiceSelect id="player-program-code" label="Code" options={PROGRAM_OPTIONS} value={profileDraft.programCode} onChange={(value) => updateDraft('programCode', value)} />
      </div>
      <div className="player-account__field">
        <span>Filière <small>(facultative)</small></span>
        <ProfileChoiceSelect
          id="player-filiere"
          label="Filière"
          options={FILIERE_OPTIONS.some((option) => option.value === profileDraft.filiere)
            ? FILIERE_OPTIONS
            : [...FILIERE_OPTIONS, { value: profileDraft.filiere, label: profileDraft.filiere }]}
          value={profileDraft.filiere}
          onChange={(value) => updateDraft('filiere', value)}
        />
      </div>
      <label className="player-account__field player-account__field--wide" htmlFor="player-bio">
        <span>Bio <small>(facultative)</small></span>
        <textarea id="player-bio" rows="3" maxLength={280} value={profileDraft.bio} onChange={(event) => updateDraft('bio', event.target.value)} />
      </label>
    </div>
  );

  return (
    <div className="player-account">
      {error && <p className="player-account__message player-account__message--error" role="alert">{error}</p>}
      {status && <p className="player-account__message" role="status">{status}</p>}

      {(mode === 'login' || mode === 'confirmed') && (
        <>
          {mode === 'confirmed' && <p className="player-account__notice">Adresse confirmée. Connecte-toi pour accéder à ton compte.</p>}
          <form className="player-account__form" onSubmit={submitSignIn}>
            <Field id="player-login-email" label="Adresse e-mail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <Field id="player-login-password" label="Mot de passe" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            <div className="player-account__login-actions">
              <button type="button" className="player-account__text-button" onClick={() => { setMode('forgot'); setError(''); setStatus(''); }}>Mot de passe oublié ?</button>
              <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
            </div>
          </form>
          <div className="player-account__new-account">
            <span>Nouveau&nbsp;?</span>
            <button type="button" className="player-account__text-button" onClick={() => { setMode('signup'); setError(''); setStatus(''); }}>Créer un compte</button>
          </div>
        </>
      )}

      {mode === 'signup' && (
        <form className="player-account__form" onSubmit={submitSignUp}>
          <p className="player-account__notice">Crée ton compte avec ton adresse e-mail. Le pseudo sera affiché dans le classement.</p>
          <Field id="player-signup-email" label="Adresse e-mail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          {profileFields}
          <Field id="player-signup-password" label={`Mot de passe (8 caractères minimum)`} type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={password} onChange={(event) => setPassword(event.target.value)} />
          <Field id="player-signup-confirm-password" label="Confirmer le mot de passe" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
          <div className="player-account__signup-actions">
            <button className="player-account__text-button" type="button" onClick={() => { setMode('login'); setError(''); setStatus(''); }}>J’ai déjà un compte</button>
            <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}</button>
          </div>
        </form>
      )}

      {mode === 'check-email' && (
        <div className="player-account__form player-account__form--check-email">
          <button type="button" className="player-account__text-button" onClick={() => { setMode('login'); setPassword(''); setStatus(''); }}>Retour à la connexion</button>
        </div>
      )}

      {mode === 'forgot' && (
        <form className="player-account__form" onSubmit={submitForgotPassword}>
          <p className="player-account__notice">Nous t’enverrons un lien pour choisir un nouveau mot de passe.</p>
          <Field id="player-reset-email" label="Adresse e-mail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le lien'}</button>
          <div className="player-account__links"><button type="button" onClick={() => { setMode('login'); setError(''); setStatus(''); }}>Retour à la connexion</button></div>
        </form>
      )}

      {mode === 'recovery' && (
        <form className="player-account__form" onSubmit={submitNewPassword}>
          <p className="player-account__notice">Choisis un nouveau mot de passe pour ton compte.</p>
          <Field id="player-new-password" label={`Nouveau mot de passe (${MIN_PASSWORD_LENGTH} caractères minimum)`} type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={password} onChange={(event) => setPassword(event.target.value)} />
          <Field id="player-new-password-confirm" label="Confirmer le mot de passe" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
          <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Modification…' : 'Changer le mot de passe'}</button>
        </form>
      )}

      {mode === 'complete-profile' && user && (
        <form className="player-account__form" onSubmit={submitProfile}>
          <p className="player-account__notice">Complète ton profil pour utiliser ton compte.</p>
          {profileFields}
          <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer mon profil'}</button>
          <div className="player-account__links"><button type="button" onClick={signOut}>Se déconnecter</button></div>
        </form>
      )}

      {mode === 'profile' && user && profile && (
        <div className="player-account__profile">
          <section className="player-account__profile-card" aria-label="Profil joueur">
            <div className="player-account__profile-card-header">
              <div className="player-account__profile-heading">
                <p className="player-account__name">{profile.first_name} {profile.last_name}</p>
                <span className="player-account__promo">{profile.program_code}{String(profile.arrival_year).slice(-2)}</span>
                {profile.filiere && (
                  <>
                    <BrandDivider />
                    <span className="player-account__filiere">{profile.filiere}</span>
                  </>
                )}
              </div>
              <button
                ref={profileEditButtonRef}
                type="button"
                className="player-account__edit-icon"
                aria-label="Modifier mon profil"
                aria-expanded={profileEditorVisible && editingProfile}
                aria-controls="player-profile-edit"
                onClick={openProfileEditor}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m3 14.5-.7 3.2 3.2-.7L16.8 5.7a1.8 1.8 0 0 0-2.5-2.5L3 14.5Z" /><path d="m12.9 4.6 2.5 2.5" /></svg>
              </button>
            </div>
            <p className="player-account__pseudo player-account__profile-pseudo">{profile.pseudo}</p>
            <p className="player-account__email">{user.email}</p>
            {profile.bio && <p className="player-account__bio">{profile.bio}</p>}
            <div className="player-account__stats" aria-label="Statistiques de jeu">
              <div><strong>{stats.daily}</strong><span>Défis quotidiens</span></div>
              <div><strong>{stats.weekly}</strong><span>Défis hebdomadaires</span></div>
              <div><strong>{stats.points}</strong><span>Points</span></div>
            </div>
            {statsUnavailable && <p className="player-account__stats-hint">Stats indisponibles : exécute la dernière version du script des comptes dans Supabase.</p>}
          </section>
          {profileEditorVisible && (
            <>
              <button type="button" className="player-account__edit-collapse" onClick={closeProfileEditor} aria-label="Replier la modification du profil">
                <svg viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path d="m3 9 7-7 7 7" /></svg>
              </button>
              <form
                id="player-profile-edit"
                className={'player-account__form player-account__edit-form' + (editingProfile ? ' is-open' : '')}
                onSubmit={submitProfile}
                aria-hidden={!editingProfile}
              >
                <fieldset className="player-account__edit-fieldset" disabled={!editingProfile}>
                  {profileFields}
                  <button className="btn btn--ghost player-account__submit" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
                </fieldset>
              </form>
            </>
          )}
          <div className="player-account__profile-actions">
            <button type="button" className="player-account__text-button" onClick={() => { setMode('recovery'); setPassword(''); setPasswordConfirmation(''); setStatus(''); }}>Changer mon mot de passe</button>
            <button type="button" className="player-account__text-button" onClick={signOut}>Se déconnecter</button>
          </div>
        </div>
      )}
    </div>
  );
}
