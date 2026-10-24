import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import houseIcon from './assets/house.svg';
import BrandDivider from './components/BrandDivider';
import NameMatch from './components/NameMatch';
import ShapeSwatch from './components/ShapeSwatch';
import TopoBackground, { TopoDivider } from './components/TopoBackground';
import PlayerAccountPanel, { updatePlayerAccountStatsCache } from './components/PlayerAccountPanel';
import PlayerAccountAdminPanel from './components/PlayerAccountAdminPanel';
import { getPlayerChallengeCompletions, hasPendingPasswordRecovery, hasSupabaseAuthCallback, recordPlayerChallengeCompletion } from './lib/playerAccounts';
import { getAccountAuthClient, getSuperadminSession, isSupabaseConfigured } from './lib/supabase';
import { describePromo, formatStudentAffiliations } from './lib/promo';
import { buildDistances, buildGameGraph, compareIds, getChallenge, isOnPossiblePath } from '../supabase/functions/_shared/gameChallengeCore';
import {
  normalizeStudentSearch as normalizeName,
  searchStudentsByName,
} from './lib/studentSearch';
import { getGameChallengeArchive, saveGameChallengeArchive } from './lib/supabase';
import GameGraph from './game/GameGraph';
import {
  dailyPeriodKey,
  formatArchiveDate,
  formatArchiveMonth,
  formatCountdown,
  formatWeeklyReset,
  getArchiveMonthCells,
  getNextParisNoon,
  parisDateKey,
  weeklyPeriodKey,
} from './game/gameDates';
import {
  endpointId,
  findChallengePath,
  findHintPath,
  findShortestPathsThrough,
  hasPlayableChallenge,
} from './game/gamePaths';
import {
  HELP_EXAMPLE_END_ID,
  HELP_EXAMPLE_GRAPH,
  HELP_EXAMPLE_NODES,
  HELP_EXAMPLE_ORDERED_IDS,
  HELP_EXAMPLE_POSSIBLE_IDS,
  HELP_EXAMPLE_SHORTEST_EDGE_KEYS,
  HELP_EXAMPLE_SHORTEST_IDS,
  HELP_EXAMPLE_START_ID,
} from './game/helpExample';
import './GamePage.css';

// Keep the last resolved auth state across GamePage mounts (for example when
// switching between the graph and the game) so opening the account never
// flashes a loading/login state while Supabase restores its persisted session.
let cachedGameAccountAuth = { ready: false, user: null };
function getInitialAccountPanelState() {
  const accountState = new URLSearchParams(window.location.search).get('account');
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (accountState === 'recovery' || accountState === 'confirmed') {
    return { panel: 'account', mode: accountState };
  }
  if (hashParams.get('type') === 'recovery') return { panel: 'account', mode: 'recovery' };
  if (hashParams.get('type') === 'signup') return { panel: 'account', mode: 'confirmed' };
  if (hasPendingPasswordRecovery()) return { panel: 'account', mode: 'recovery' };
  if (hasSupabaseAuthCallback()) return { panel: 'account', mode: 'login' };
  return { panel: null, mode: 'login' };
}
const endpointNameClass = (name) => {
  const length = String(name ?? '').length;
  return length >= 26
    ? 'game-endpoint__name--very-long'
    : length >= 18
      ? 'game-endpoint__name--long'
      : '';
};


function challengeArchiveKey(mode, periodKey, promoYears) {
  return mode + ':' + periodKey + ':' + [...promoYears].map(Number).sort((a, b) => a - b).join(',');
}

async function getOrFreezeChallengeArchive(mode, periodKey, promoYears, challenge) {
  const scope = [...promoYears].map(Number).sort((a, b) => a - b).join(',');
  const existing = await getGameChallengeArchive(mode, periodKey, scope);
  if (existing) return existing;
  if (!challenge) return null;
  return saveGameChallengeArchive(mode, periodKey, promoYears);
}


export default function GamePage({ students, links }) {
  const [entryAccountState] = useState(getInitialAccountPanelState);
  const [mode, setMode] = useState('daily');
  const [round, setRound] = useState(0);
  const [attemptCount, setAttemptCount] = useState(1);
  const [challengeClock, setChallengeClock] = useState(() => new Date());
  const [practiceSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [foundIds, setFoundIds] = useState([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintedStudentIds, setHintedStudentIds] = useState([]);
  const [hintPathIds, setHintPathIds] = useState([]);
  const [completionRecord, setCompletionRecord] = useState(null);
  const [completedChallengePeriods, setCompletedChallengePeriods] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activePanel, setActivePanel] = useState(entryAccountState.panel);
  const [selectedLeaderboardPlayer, setSelectedLeaderboardPlayer] = useState(null);
  const [leaderboardPlayers, setLeaderboardPlayers] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');
  const leaderboardHasPlayersRef = useRef(false);
  const [accountInitialMode, setAccountInitialMode] = useState(entryAccountState.mode);
  const [gameSuperadminSession, setGameSuperadminSession] = useState(null);
  const [accountConnected, setAccountConnected] = useState(() => Boolean(cachedGameAccountAuth.user));
  const [accountAuthReady, setAccountAuthReady] = useState(() => cachedGameAccountAuth.ready);
  const [accountAuthUser, setAccountAuthUser] = useState(() => cachedGameAccountAuth.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPromoYears, setSelectedPromoYears] = useState(() => {
    try {
      const saved = window.localStorage.getItem('ensgdle-playable-promos-v1');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return null;
      const years = [...new Set(parsed.map(Number).filter(Number.isFinite))];
      return years.length >= 3 ? years : null;
    } catch {
      return null;
    }
  });
  const [promoDraft, setPromoDraft] = useState(null);
  const [archiveMode, setArchiveMode] = useState('daily');
  const [archiveMonth, setArchiveMonth] = useState(() => {
    const currentDate = new Date(parisDateKey(new Date()) + 'T12:00:00Z');
    return new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
  });
  const [archiveDate, setArchiveDate] = useState(null);
  const [archiveSelection, setArchiveSelection] = useState(null);
  const [frozenChallengeArchives, setFrozenChallengeArchives] = useState({});
  const [resolvedChallengeArchives, setResolvedChallengeArchives] = useState(() => new Set());
  const menuRef = useRef(null);
  const helpButtonRef = useRef(null);
  const promoModeButtonRef = useRef(null);
  const solutionButtonRef = useRef(null);
  const panelRef = useRef(null);
  const panelCloseRef = useRef(null);
  const recordedCompletionRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    let active = true;
    let subscription;
    const hasResolvedAuthState = cachedGameAccountAuth.ready;
    let initialSessionResolved = hasResolvedAuthState;
    let hasPendingSessionEvent = false;
    let pendingSession = null;
    const syncSession = (session) => {
      const user = session?.user ?? null;
      cachedGameAccountAuth = { ready: true, user };
      setAccountAuthUser(user);
      setAccountConnected(Boolean(user));
      setAccountAuthReady(true);
    };
    getAccountAuthClient().then(async (client) => {
      if (!active) return;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (!initialSessionResolved) {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            hasPendingSessionEvent = true;
            pendingSession = session;
          }
          return;
        }
        syncSession(session);
      });
      subscription = data.subscription;
      // The singleton Supabase client emits INITIAL_SESSION to new listeners.
      // Reuse our in-memory auth state and let that event keep it current instead
      // of calling getSession again on every return to the game.
      if (hasResolvedAuthState) return;
      const { data: sessionData } = await client.auth.getSession();
      initialSessionResolved = true;
      if (active) syncSession(hasPendingSessionEvent ? pendingSession : sessionData?.session);
    }).catch(() => {
      initialSessionResolved = true;
      if (active && !hasResolvedAuthState) syncSession(null);
    });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!accountConnected || !accountAuthUser?.id) {
      setCompletedChallengePeriods(new Set());
      return () => {
        active = false;
      };
    }

    getPlayerChallengeCompletions()
      .then((completions) => {
        if (!active) return;
        setCompletedChallengePeriods(new Set(
          completions.map(({ mode: completedMode, period_key: periodKey, promo_scope: promoScope }) => (
            `${completedMode}:${periodKey}:${promoScope}`
          ))
        ));
      })
      .catch((error) => {
        if (active) {
          setCompletedChallengePeriods(new Set());
          console.warn('[archives] Impossible de charger les défis déjà réalisés :', error.message);
        }
      });

    return () => {
      active = false;
    };
  }, [accountConnected, accountAuthUser?.id]);

  useEffect(() => {
    let active = true;
    const resolveGameSuperadmin = async () => {
      try {
        const savedAdminSession = await getSuperadminSession();
        if (savedAdminSession) {
          if (active) setGameSuperadminSession(savedAdminSession);
          return;
        }
        const client = await getAccountAuthClient();
        const { data: sessionData } = await client.auth.getSession();
        const session = sessionData?.session;
        if (!session) {
          if (active) setGameSuperadminSession(null);
          return;
        }
        const { data, error } = await client
          .from('superadmins')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (active) setGameSuperadminSession(error || !data ? null : session);
      } catch {
        if (active) setGameSuperadminSession(null);
      }
    };
    void resolveGameSuperadmin();
    return () => {
      active = false;
    };
  }, [accountAuthReady, accountAuthUser?.id]);

  useEffect(() => {
    if (activePanel !== 'leaderboard') return undefined;
    let active = true;
    if (!isSupabaseConfigured()) {
      setLeaderboardPlayers([]);
      leaderboardHasPlayersRef.current = false;
      setLeaderboardLoading(false);
      setLeaderboardError('Le classement réel nécessite la configuration de Supabase.');
      return undefined;
    }

    if (!leaderboardHasPlayersRef.current) setLeaderboardLoading(true);
    setLeaderboardError('');
    const refreshLeaderboard = async () => {
      try {
        const client = await getAccountAuthClient();
        const { data, error } = await client.rpc('get_player_leaderboard');
        if (error) throw error;
        const nextPlayers = (data ?? []).map((player) => ({
          pseudo: player.pseudo,
          firstName: player.first_name,
          lastName: player.last_name,
          promo: String(player.program_code ?? '') + String(player.arrival_year ?? '').slice(-2),
          filiere: String(player.filiere ?? '').trim().replace(/^filière non renseignée$/i, ''),
          bio: String(player.bio ?? '').trim(),
          daily: Number(player.daily_challenges ?? 0),
          weekly: Number(player.weekly_challenges ?? 0),
          score: Number(player.points ?? 0),
          isCurrentUser: player.is_current_user === true,
        })).sort((left, right) => (
          right.score - left.score || left.pseudo.localeCompare(right.pseudo, 'fr')
        ));
        if (!active) return;
        setLeaderboardPlayers(nextPlayers);
        leaderboardHasPlayersRef.current = nextPlayers.length > 0;
        setSelectedLeaderboardPlayer((current) => current
          ? nextPlayers.find((player) => player.pseudo === current.pseudo) ?? null
          : null);
        setLeaderboardError('');
      } catch (loadError) {
        if (!active) return;
        const message = String(loadError?.message ?? '');
        setLeaderboardError(
          loadError?.code === 'PGRST202' || /get_player_leaderboard|schema cache|could not find/i.test(message)
            ? 'Le classement réel n’est pas encore configuré. Exécute la dernière version de supabase/player_accounts.sql dans Supabase.'
            : 'Le classement n’a pas pu être chargé. Vérifie la connexion et réessaie.'
        );
      } finally {
        if (active) setLeaderboardLoading(false);
      }
    };

    void refreshLeaderboard();
    const refreshTimer = window.setInterval(() => void refreshLeaderboard(), 30_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [activePanel]);

  useEffect(() => {
    let timer;
    const scheduleClockRefresh = () => {
      const now = new Date();
      const nextMinute = (Math.floor(now.getTime() / 60000) + 1) * 60000;
      const nextRefresh = Math.min(nextMinute, getNextParisNoon(now));
      timer = window.setTimeout(() => {
        setChallengeClock(new Date());
        scheduleClockRefresh();
      }, Math.max(0, nextRefresh - now.getTime() + 30));
    };
    scheduleClockRefresh();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!activePanel || !window.matchMedia('(max-width: 767px)').matches) return undefined;

    const scrollContainer = document.querySelector('.game-page');
    if (!scrollContainer) return undefined;

    const scrollTop = scrollContainer.scrollTop;
    const previousOverflow = scrollContainer.style.getPropertyValue('overflow-y');
    const previousOverflowPriority = scrollContainer.style.getPropertyPriority('overflow-y');
    scrollContainer.style.setProperty('overflow-y', 'hidden');

    return () => {
      if (previousOverflow) {
        scrollContainer.style.setProperty('overflow-y', previousOverflow, previousOverflowPriority);
      } else {
        scrollContainer.style.removeProperty('overflow-y');
      }
      scrollContainer.scrollTop = scrollTop;
    };
  }, [activePanel]);

  useEffect(() => {
    if (!activePanel) return undefined;
    const focusPanel = () => {
      const compactPanel = window.matchMedia('(max-width: 767px)').matches;
      if (compactPanel) panelRef.current?.focus();
      else panelCloseRef.current?.focus();
    };
    const handlePanelKeyDown = (event) => {
      if (event.key === 'Escape') setActivePanel(null);
      if (event.key === 'Tab') {
        const focusable = [...(panelRef.current?.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? [])].filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handlePanelKeyDown);
    focusPanel();
    return () => {
      window.removeEventListener('keydown', handlePanelKeyDown);
      const trigger = activePanel === 'solution'
        ? solutionButtonRef
        : activePanel === 'game-mode'
          ? promoModeButtonRef
          : helpButtonRef;
      trigger.current?.focus();
    };
  }, [activePanel]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenuOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeMenuOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      helpButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeMenuOnOutsideClick);
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ENSGdle · Géodata Paris';
    return () => { document.title = previousTitle; };
  }, []);

  const availablePromoYears = useMemo(
    () => [...new Set(students.map((student) => Number(student.promo)).filter(Number.isFinite))]
      .sort((a, b) => b - a),
    [students]
  );
  const promoPages = useMemo(() => {
    const pages = [];
    for (let index = 0; index < availablePromoYears.length; index += 8) {
      pages.push(availablePromoYears.slice(index, index + 8));
    }
    return pages;
  }, [availablePromoYears]);
  const playablePromoYears = useMemo(
    () => selectedPromoYears === null
      ? availablePromoYears
      : availablePromoYears.filter((promo) => selectedPromoYears.includes(promo)),
    [availablePromoYears, selectedPromoYears]
  );
  const playablePromoSet = useMemo(() => new Set(playablePromoYears), [playablePromoYears]);
  const currentEligibleStudents = useMemo(
    () => students.filter((student) => playablePromoSet.has(Number(student.promo))),
    [students, playablePromoSet]
  );
  const draftPromoYears = promoDraft ?? playablePromoYears;
  const draftPromoSet = useMemo(() => new Set(draftPromoYears), [draftPromoYears]);
  const draftStudents = useMemo(
    () => students.filter((student) => draftPromoSet.has(Number(student.promo))),
    [students, draftPromoSet]
  );
  const promoDraftCanPlay = useMemo(
    () => draftPromoYears.length >= 3 && hasPlayableChallenge(draftStudents, links),
    [draftPromoYears, draftStudents, links]
  );
  const currentGraph = useMemo(() => buildGameGraph(currentEligibleStudents, links), [currentEligibleStudents, links]);
  const currentDailyPeriod = dailyPeriodKey(challengeClock);
  const currentWeeklyPeriod = weeklyPeriodKey(challengeClock);
  const challengePeriod = archiveSelection?.mode === mode
    ? archiveSelection.periodKey
    : mode === 'daily'
      ? currentDailyPeriod
      : mode === 'weekly'
        ? currentWeeklyPeriod
        : 'practice:' + practiceSeed + ':' + round;
  const challengePromoYears = archiveSelection?.mode === mode && Array.isArray(archiveSelection.promoYears)
    ? archiveSelection.promoYears
    : playablePromoYears;
  const challengePromoSet = useMemo(() => new Set(challengePromoYears.map(Number)), [challengePromoYears]);
  const archiveKey = mode === 'practice' ? null : challengeArchiveKey(mode, challengePeriod, challengePromoYears);
  const frozenArchive = archiveKey ? frozenChallengeArchives[archiveKey] ?? null : null;
  const archiveGraphSnapshot = useMemo(() => ({
    nodes: students.map((student) => ({ ...student })),
    links: links.map((link) => ({ source: endpointId(link.source), target: endpointId(link.target) })),
  }), [students, links]);
  const graphSource = frozenArchive?.graph ?? archiveGraphSnapshot;
  const eligibleStudents = useMemo(
    () => graphSource.nodes.filter((student) => challengePromoSet.has(Number(student.promo))),
    [graphSource, challengePromoSet]
  );
  const challengeLinks = graphSource.links;
  const activePromoLabels = challengePromoYears.map((promo) => describePromo(promo, challengeClock).label);
  const activePromoLevels = activePromoLabels.map((label) => Number(label.match(/^IT(\d+)$/)?.[1]));
  const sortedPromoLevels = activePromoLevels.filter(Number.isFinite).sort((a, b) => a - b);
  const hasContiguousLevels = sortedPromoLevels.length === activePromoLabels.length
    && sortedPromoLevels.every((level, index) => index === 0 || level === sortedPromoLevels[index - 1] + 1);
  const promoModeRange = hasContiguousLevels && sortedPromoLevels.length > 1
    ? ['IT' + sortedPromoLevels[0], 'IT' + sortedPromoLevels[sortedPromoLevels.length - 1]]
    : null;
  const allPromosSelected = challengePromoYears.length === availablePromoYears.length;
  const promoModeLabel = allPromosSelected
    ? 'Toutes promos'
    : promoModeRange
      ? promoModeRange[0] + ' à ' + promoModeRange[1]
      : activePromoLabels.length <= 3
        ? activePromoLabels.join(' · ')
        : activePromoLabels.length + ' promos';
  const promoModeAccessibleLabel = 'Promos du jeu : ' + promoModeLabel + '. Modifier la sélection.';
  const graph = useMemo(() => buildGameGraph(eligibleStudents, challengeLinks), [eligibleStudents, challengeLinks]);
  const weeklyChallengeAvailable = useMemo(
    () => Boolean(getChallenge(graph, 'weekly', practiceSeed, round, currentWeeklyPeriod)?.constraint),
    [graph, practiceSeed, round, currentWeeklyPeriod]
  );
  const todayKey = parisDateKey(challengeClock);
  const firstArchiveDate = '2026-09-01';
  const archiveCalendarCells = getArchiveMonthCells(archiveMonth).map((periodKey) => {
    if (!periodKey) return null;
    const day = new Date(periodKey + 'T12:00:00Z');
    const available = periodKey >= firstArchiveDate && (archiveMode === 'daily'
      ? periodKey === todayKey || periodKey <= currentDailyPeriod
      : day.getUTCDay() === 1 && periodKey <= currentWeeklyPeriod);
    return {
      periodKey,
      day: day.getUTCDate(),
      available,
      isToday: periodKey === todayKey,
      completed: completedChallengePeriods.has(challengeArchiveKey(archiveMode, periodKey, playablePromoYears))
        || completedChallengePeriods.has(`${archiveMode}:${periodKey}:legacy`),
    };
  });
  const currentArchiveMonth = new Date(todayKey + 'T12:00:00Z');
  const firstArchiveMonth = new Date('2026-09-01T12:00:00Z');
  const canGoToPreviousArchiveMonth = archiveMonth.getUTCFullYear() > firstArchiveMonth.getUTCFullYear()
    || (archiveMonth.getUTCFullYear() === firstArchiveMonth.getUTCFullYear()
      && archiveMonth.getUTCMonth() > firstArchiveMonth.getUTCMonth());
  const canAdvanceArchiveMonth = archiveMonth.getUTCFullYear() < currentArchiveMonth.getUTCFullYear()
    || (archiveMonth.getUTCFullYear() === currentArchiveMonth.getUTCFullYear()
      && archiveMonth.getUTCMonth() < currentArchiveMonth.getUTCMonth());
  const archivePreviewKey = archiveDate
    ? challengeArchiveKey(archiveMode, archiveDate, playablePromoYears)
    : null;
  const archivePreview = archivePreviewKey ? frozenChallengeArchives[archivePreviewKey] ?? null : null;
  const archiveChallenge = archivePreview?.challenge ?? (archiveDate
    ? getChallenge(currentGraph, archiveMode, 0, 0, archiveDate)
    : null);
  const archivePreviewGraph = useMemo(() => archivePreview
    ? buildGameGraph(
      archivePreview.graph.nodes.filter((student) => playablePromoYears.includes(Number(student.promo))),
      archivePreview.graph.links
    )
    : currentGraph, [archivePreview, playablePromoYears, currentGraph]);
  const archiveStart = archiveChallenge ? archivePreviewGraph.byId.get(archiveChallenge.startId) : null;
  const archiveEnd = archiveChallenge ? archivePreviewGraph.byId.get(archiveChallenge.endId) : null;
  useEffect(() => {
    if (selectedPromoYears === null || playablePromoYears.length >= 3) return;
    setSelectedPromoYears(null);
    try {
      window.localStorage.removeItem('ensgdle-playable-promos-v1');
    } catch {
      // Fall back to all promos for this session when browser storage is unavailable.
    }
  }, [selectedPromoYears, playablePromoYears]);
  const currentPeriodRef = useRef(challengePeriod);
  useEffect(() => {
    if (currentPeriodRef.current === challengePeriod) return;
    currentPeriodRef.current = challengePeriod;
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setHintPathIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
  }, [challengePeriod]);

  const generatedChallenge = useMemo(
    () => getChallenge(
      graph,
      mode,
      practiceSeed,
      round,
      challengePeriod
    ),
    [graph, mode, practiceSeed, round, challengePeriod]
  );
  const challenge = frozenArchive?.challenge ?? generatedChallenge;
  const awaitingChallengeArchive = mode !== 'practice'
    && Boolean(archiveKey && !frozenArchive && !resolvedChallengeArchives.has(archiveKey));
  useEffect(() => {
    let cancelled = false;
    const persistChallenge = async (snapshotMode, periodKey) => {
      const key = challengeArchiveKey(snapshotMode, periodKey, playablePromoYears);
      const candidate = getChallenge(currentGraph, snapshotMode, 0, 0, periodKey);
      if (!candidate) {
        setResolvedChallengeArchives((current) => new Set(current).add(key));
        return;
      }
      if (frozenChallengeArchives[key]) return;
      try {
        const record = await getOrFreezeChallengeArchive(
          snapshotMode,
          periodKey,
          playablePromoYears,
          candidate
        );
        if (!cancelled && record) {
          setFrozenChallengeArchives((current) => ({ ...current, [key]: record }));
        }
        if (!cancelled) {
          setResolvedChallengeArchives((current) => new Set(current).add(key));
        }
      } catch (error) {
        console.warn('[défis] Impossible de charger ou figer l’archive :', error.message);
        if (!cancelled) {
          setResolvedChallengeArchives((current) => new Set(current).add(key));
        }
      }
    };
    void Promise.all([
      persistChallenge('daily', currentDailyPeriod),
      persistChallenge('weekly', currentWeeklyPeriod),
    ]);
    return () => { cancelled = true; };
  }, [
    currentGraph,
    currentDailyPeriod,
    currentWeeklyPeriod,
    playablePromoYears,
    frozenChallengeArchives,
    archiveGraphSnapshot,
  ]);
  const startId = challenge?.startId;
  const endId = challenge?.endId;
  const requiredStudentId = challenge?.constraint?.type === 'through'
    ? challenge.constraint.studentId
    : null;
  const forbiddenStudentId = challenge?.constraint?.type === 'avoid'
    ? challenge.constraint.studentId
    : null;
  const start = graph.byId.get(startId);
  const end = graph.byId.get(endId);

  const visibleIds = useMemo(
    () => new Set([startId, endId, requiredStudentId, forbiddenStudentId, ...foundIds].filter(Boolean)),
    [startId, endId, requiredStudentId, forbiddenStudentId, foundIds]
  );
  const shownNodes = useMemo(
    () => [...visibleIds].map((id) => graph.byId.get(id)).filter(Boolean),
    [visibleIds, graph.byId]
  );
  const shortestPath = useMemo(
    () => challenge?.solutionPath ?? [],
    [challenge]
  );
  const shortestPathEdgeKeys = useMemo(
    () => new Set(shortestPath.slice(1).map((target, index) => [shortestPath[index], target].sort().join('|'))),
    [shortestPath]
  );
  const shortestNodes = useMemo(
    () => shortestPath.map((id) => graph.byId.get(id)).filter(Boolean),
    [shortestPath, graph.byId]
  );
  const solutionNodes = useMemo(() => {
    const byId = new Map(shortestNodes.map((student) => [student.id, student]));
    const ruleNode = challenge?.constraint ? graph.byId.get(challenge.constraint.studentId) : null;
    if (ruleNode && !byId.has(ruleNode.id)) byId.set(ruleNode.id, ruleNode);
    return [...byId.values()];
  }, [challenge, graph.byId, shortestNodes]);
  const solutionGraph = useMemo(() => {
    const edgeKeys = new Set(shortestPathEdgeKeys);
    if (forbiddenStudentId) {
      const pathIds = new Set(shortestPath);
      graph.edges.forEach((edge) => {
        const pathNeighborId = edge.source === forbiddenStudentId
          ? edge.target
          : edge.target === forbiddenStudentId ? edge.source : null;
        if (pathNeighborId && pathIds.has(pathNeighborId)) {
          edgeKeys.add([edge.source, edge.target].sort().join('|'));
        }
      });
    }
    return {
      ...graph,
      edges: graph.edges.filter((edge) => edgeKeys.has([edge.source, edge.target].sort().join('|'))),
    };
  }, [forbiddenStudentId, graph, shortestPath, shortestPathEdgeKeys]);
  const solutionPossibleIds = useMemo(() => new Set(shortestPath), [shortestPath]);
  const hintedNodes = useMemo(() => hintsUsed >= 3
    ? shortestNodes
    : hintedStudentIds.map((id) => graph.byId.get(id)).filter(Boolean),
  [hintsUsed, hintedStudentIds, shortestNodes, graph.byId]);
  const shortestPathData = useMemo(() => {
    if (!challenge) return { nodeIds: new Set(), edgeKeys: new Set() };

    if (challenge.constraint?.type === 'through') {
      return findShortestPathsThrough(
        graph.adjacency,
        startId,
        challenge.constraint.studentId,
        endId,
        null,
        challenge.distance
      );
    }

    const avoidId = challenge.constraint?.type === 'avoid'
      ? challenge.constraint.studentId
      : null;
    const permittedIds = avoidId
      ? new Set([...graph.adjacency.keys()].filter((id) => id !== avoidId))
      : null;
    const fromStart = buildDistances(graph.adjacency, startId, permittedIds);
    const fromEnd = buildDistances(graph.adjacency, endId, permittedIds);
    const nodeIds = new Set([...fromStart]
      .filter(([id, distance]) => distance + (fromEnd.get(id) ?? Infinity) === challenge.distance)
      .map(([id]) => id));
    const edgeKeys = new Set(graph.edges
      .filter((edge) => !permittedIds || (permittedIds.has(edge.source) && permittedIds.has(edge.target)))
      .filter((edge) => (
        fromStart.get(edge.source) + 1 + fromEnd.get(edge.target) === challenge.distance
        || fromStart.get(edge.target) + 1 + fromEnd.get(edge.source) === challenge.distance
      ))
      .map((edge) => [edge.source, edge.target].sort(compareIds).join('|')));
    return { nodeIds, edgeKeys };
  }, [graph.adjacency, graph.edges, challenge, startId, endId]);
  const shortestIds = shortestPathData.nodeIds;
  const shortestEdgeKeys = shortestPathData.edgeKeys;
  const suggestedHintPath = useMemo(() => {
    if (!challenge || shortestPath.length < 2) return shortestPath;
    const candidateIds = foundIds.slice().reverse().filter((id) => shortestIds.has(id));
    for (const candidateId of candidateIds) {
      const path = findHintPath(
        graph.adjacency,
        startId,
        endId,
        shortestEdgeKeys,
        [requiredStudentId, candidateId],
        challenge.distance
      );
      if (path.length) return path;
    }
    const path = findHintPath(
      graph.adjacency,
      startId,
      endId,
      shortestEdgeKeys,
      [requiredStudentId],
      challenge.distance
    );
    return path.length ? path : shortestPath;
  }, [challenge, shortestPath, foundIds, shortestIds, graph.adjacency, startId, endId, shortestEdgeKeys, requiredStudentId]);
  const hintPath = hintPathIds.length ? hintPathIds : suggestedHintPath;
  const nextHintStudent = hintPath
    .slice(1, -1)
    .map((id) => graph.byId.get(id))
    .find((student) => student && !visibleIds.has(student.id));
  const previousHintStudent = hintPath
    .slice(1, -1)
    .reverse()
    .map((id) => graph.byId.get(id))
    .find((student) => student && !visibleIds.has(student.id));
  const possibleIds = useMemo(() => {
    const ids = new Set([startId, endId, requiredStudentId].filter(Boolean));
    const avoidId = challenge?.constraint?.type === 'avoid'
      ? challenge.constraint.studentId
      : null;
    const permittedIds = avoidId
      ? new Set([...graph.adjacency.keys()].filter((id) => id !== avoidId))
      : null;
    foundIds.forEach((id) => {
      if (challenge?.constraint?.type === 'through') {
        if (shortestIds.has(id)) ids.add(id);
        return;
      }
      if (permittedIds && !permittedIds.has(id)) return;
      if (isOnPossiblePath(graph.adjacency, startId, id, endId, permittedIds)) ids.add(id);
    });
    return ids;
  }, [graph.adjacency, startId, endId, requiredStudentId, foundIds, challenge, shortestIds]);
  const winningPath = useMemo(
    () => challenge ? findChallengePath(graph.adjacency, startId, endId, visibleIds, challenge.constraint) : [],
    [graph.adjacency, challenge, startId, endId, visibleIds]
  );
  const won = winningPath.length > 0
    && (hintsUsed < 3 || winningPath.length - 1 === challenge.distance);
  const shortestPathSolved = won && winningPath.length - 1 === challenge.distance;
  const baseCompletionPoints = mode === 'daily'
    ? (shortestPathSolved ? 10 : 5)
    : mode === 'weekly'
      ? (shortestPathSolved ? 20 : 10)
      : 0;
  const hintPenalty = (hintsUsed >= 1 ? 1 : 0)
    + (hintsUsed >= 2 ? 1 : 0)
    + (hintsUsed >= 3 ? 2 : 0);
  const completionPoints = Math.max(0, baseCompletionPoints - hintPenalty);
  const trackableCompletion = accountConnected
    && accountAuthUser?.id
    && (mode === 'daily' || mode === 'weekly')
    ? accountAuthUser.id + ':' + challengeArchiveKey(mode, challengePeriod, challengePromoYears)
    : null;
  const currentCompletionRecord = completionRecord?.key === trackableCompletion
    ? completionRecord
    : null;
  // Un visiteur sans compte ne peut rien enregistrer : la fonction serveur refuse
  // l'appel (secure_player_challenge_scores.sql). Annoncer « +X points » serait
  // donc faux — aucun point n'est écrit nulle part. On l'invite à se connecter.
  // Tant que la session n'est pas résolue, on affiche l'état d'attente plutôt que
  // de faire clignoter un message qui changera.
  const anonymousCompletion = mode !== 'practice'
    && !accountConnected
    && (accountAuthReady || !isSupabaseConfigured());
  const awaitingSession = mode !== 'practice' && !accountConnected && !anonymousCompletion;
  useEffect(() => {
    if (!won || !trackableCompletion || recordedCompletionRef.current === trackableCompletion) return;
    recordedCompletionRef.current = trackableCompletion;
    setCompletionRecord({ key: trackableCompletion, status: 'saving' });
    recordPlayerChallengeCompletion(mode, challengePeriod, challengePromoYears, winningPath, hintsUsed)
      .then((result) => {
        if (!result) {
          setCompletionRecord({ key: trackableCompletion, status: 'failed' });
          return;
        }
        setCompletedChallengePeriods((current) => {
          const next = new Set(current);
          next.add(challengeArchiveKey(mode, challengePeriod, challengePromoYears));
          return next;
        });
        if (result.stats && accountAuthUser?.id) updatePlayerAccountStatsCache(accountAuthUser.id, result.stats);
        setCompletionRecord((current) => (
          current?.key === trackableCompletion && current.status === 'duplicate'
            ? current
            : {
              key: trackableCompletion,
              status: result.alreadyCompleted ? 'duplicate' : 'recorded',
            }
        ));
      })
      .catch((error) => {
        if (recordedCompletionRef.current === trackableCompletion) recordedCompletionRef.current = null;
        setCompletionRecord({ key: trackableCompletion, status: 'failed' });
        console.warn('[scores] Impossible d’enregistrer cette réussite :', error.message);
      });
  }, [won, trackableCompletion, mode, challengePeriod, challengePromoYears, winningPath, hintsUsed, accountAuthUser]);
  const attemptLimit = (challenge?.distance ?? 0) + 5;
  const lost = attemptCount > attemptLimit && !won;
  const displayedAttemptCount = Math.min(attemptCount, attemptLimit);
  const graphNodes = useMemo(() => {
    if (!lost) return shownNodes;
    const byId = new Map(shownNodes.map((student) => [student.id, student]));
    shortestNodes.forEach((student) => byId.set(student.id, student));
    return [...byId.values()];
  }, [lost, shownNodes, shortestNodes]);
  const graphPossibleIds = useMemo(() => (
    lost ? new Set([...possibleIds, ...shortestPath]) : possibleIds
  ), [lost, possibleIds, shortestPath]);

  const suggestions = useMemo(() => {
    if (!normalizeName(query)) return [];
    const candidates = eligibleStudents.filter((student) => !visibleIds.has(student.id));
    return searchStudentsByName(candidates, query, undefined, { prefixOnly: true });
  }, [eligibleStudents, query, visibleIds]);
  const selectableSuggestions = useMemo(
    () => suggestions.filter((student) => student.id !== forbiddenStudentId),
    [suggestions, forbiddenStudentId]
  );

  const clearRound = () => {
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setHintPathIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
    if (mode === 'practice') setRound((value) => value + 1);
  };

  const selectMode = (nextMode, nextArchiveSelection = null) => {
    if (nextMode === mode && !archiveSelection && !nextArchiveSelection) return;
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    setMode(nextMode);
    setArchiveSelection(nextArchiveSelection);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setHintPathIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);
    setMenuOpen(false);
  };

  const rememberChallengeArchive = (record) => {
    if (!record?.mode || !record.period_key || !record.promo_years) return;
    const key = challengeArchiveKey(record.mode, record.period_key, record.promo_years);
    setFrozenChallengeArchives((current) => ({ ...current, [key]: record }));
  };

  const archiveChallengeForPeriod = async (archiveModeToLoad, periodKey, promoYears) => {
    const key = challengeArchiveKey(archiveModeToLoad, periodKey, promoYears);
    if (frozenChallengeArchives[key]) return frozenChallengeArchives[key];
    const candidate = getChallenge(currentGraph, archiveModeToLoad, 0, 0, periodKey);
    let record = null;
    try {
      record = await getOrFreezeChallengeArchive(
        archiveModeToLoad,
        periodKey,
        promoYears,
        candidate
      );
    } catch (error) {
      console.warn('[défis] Impossible de sauvegarder cette archive :', error.message);
    }
    if (!record && candidate) {
      record = {
        mode: archiveModeToLoad,
        period_key: periodKey,
        promo_years: [...promoYears],
        challenge: candidate,
        graph: archiveGraphSnapshot,
      };
    }
    rememberChallengeArchive(record);
    return record;
  };

  const openPromoSettings = () => {
    setPromoDraft([...challengePromoYears]);
    setMenuOpen(false);
    setActivePanel('game-mode');
  };

  const toggleDraftPromo = (promo) => {
    setPromoDraft((current) => {
      const selected = current ?? challengePromoYears;
      return selected.includes(promo)
        ? selected.filter((year) => year !== promo)
        : [...selected, promo].sort((a, b) => b - a);
    });
  };

  const applyPromoSettings = () => {
    const nextYears = availablePromoYears.filter((promo) => draftPromoSet.has(promo));
    const nextStudents = students.filter((student) => nextYears.includes(Number(student.promo)));
    if (nextYears.length < 3) return;
    if (!hasPlayableChallenge(nextStudents, links)) return;

    const nextGraph = buildGameGraph(nextStudents, links);
    const nextWeeklyChallengeAvailable = Boolean(
      getChallenge(nextGraph, 'weekly', practiceSeed, round, currentWeeklyPeriod)?.constraint
    );
    const includeAllPromos = nextYears.length === availablePromoYears.length;
    const storedSelection = includeAllPromos ? null : nextYears;
    setSelectedPromoYears(storedSelection);
    setArchiveSelection(null);
    recordedCompletionRef.current = null;
    setCompletionRecord(null);
    if (mode === 'weekly' && !nextWeeklyChallengeAvailable) {
      setMode('daily');
      setArchiveSelection(null);
    }
    setPromoDraft(null);
    setFoundIds([]);
    setHintsUsed(0);
    setHintedStudentIds([]);
    setHintPathIds([]);
    setAttemptCount(1);
    setQuery('');
    setFeedback('');
    setActiveSuggestion(0);
    setActivePanel(null);

    try {
      if (includeAllPromos) window.localStorage.removeItem('ensgdle-playable-promos-v1');
      else window.localStorage.setItem('ensgdle-playable-promos-v1', JSON.stringify(nextYears));
    } catch {
      // Settings still apply for this session when browser storage is unavailable.
    }
  };

  const addStudent = (student) => {
    if (!student || !graph.byId.has(student.id) || won || lost || visibleIds.has(student.id)) return;
    if (student.id === forbiddenStudentId) {
      setFeedback(student.name + ' est interdit par la consigne de cette semaine.');
      return;
    }

    const connectsToShown = [...(graph.adjacency.get(student.id) ?? [])].some((id) => visibleIds.has(id));
    const onShortest = shortestIds.has(student.id);
    setAttemptCount((current) => current + 1);
    setFoundIds((current) => [...current, student.id]);
    setFeedback(
      onShortest
        ? challenge?.constraint
          ? student.name + ' est sur un chemin qui respecte la consigne.'
          : student.name + ' est sur un des chemins les plus courts.'
        : connectsToShown
          ? student.name + ' prolonge la chaîne affichée.'
          : student.name + ' est ajouté·e, mais ne rejoint pas encore les personnes affichées.'
    );
    setQuery('');
    setActiveSuggestion(0);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const exact = eligibleStudents.find((student) =>
      normalizeName(student.name) === normalizeName(query)
      && !visibleIds.has(student.id)
    );
    if (exact?.id === forbiddenStudentId) {
      setFeedback(exact.name + ' est interdit par la consigne de cette semaine.');
      return;
    }
    const choice = exact ?? selectableSuggestions[activeSuggestion];
    if (!choice) {
      const forbiddenMatch = suggestions.find((student) => student.id === forbiddenStudentId);
      setFeedback(forbiddenMatch
        ? forbiddenMatch.name + ' est interdit par la consigne de cette semaine.'
        : 'Aucun étudiant correspondant. Essaie un autre nom.');
      return;
    }
    addStudent(choice);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown' && selectableSuggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % selectableSuggestions.length);
    } else if (event.key === 'ArrowUp' && selectableSuggestions.length) {
      event.preventDefault();
      setActiveSuggestion((index) => (index - 1 + selectableSuggestions.length) % selectableSuggestions.length);
    } else if (event.key === 'Escape') {
      setQuery('');
      setActiveSuggestion(0);
    }
  };

  const pairLabel = mode === 'daily' ? 'Défi du jour' : mode === 'weekly' ? 'Défi de la semaine' : 'Entraînement';
  const ruleStudent = challenge?.constraint
    ? graph.byId.get(challenge.constraint.studentId)
    : null;
  const challengeQuestion = ruleStudent && mode !== 'weekly'
    ? 'Peux-tu relier ces deux étudiants '
      + (challenge.constraint.type === 'through'
        ? 'en passant obligatoirement par '
        : 'sans passer par ')
      + ruleStudent.name
      + ' ?'
    : 'Peux-tu relier ces deux étudiants ?';

  return (
    <main className="game-page">
      <TopoBackground />
      <div className="game-page__content">
        <header className="game-page__header">
          <div className="game-page__brand">
            <div className="game-page__identity">
              <h1>ENSGdle</h1>
              <p>Jeu de parrainage <BrandDivider /> {pairLabel}</p>
            </div>
            <button
              ref={promoModeButtonRef}
              className="game-promo-mode"
              type="button"
              aria-haspopup="dialog"
              aria-label={promoModeAccessibleLabel}
              onClick={openPromoSettings}
            >
              <span>Promos</span>
              {promoModeRange && !allPromosSelected ? (
                <strong className="game-promo-mode__range">
                  <span>{promoModeRange[0]}</span>
                  <BrandDivider />
                  <span>{promoModeRange[1]}</span>
                </strong>
              ) : (
                <strong>{promoModeLabel}</strong>
              )}
            </button>
          </div>
          <nav className="game-modes" aria-label="Mode de jeu">
            <button type="button" className={mode === 'daily' ? 'is-active' : ''} onClick={() => selectMode('daily')}>Journalier</button>
            <button
              type="button"
              className={mode === 'weekly' ? 'is-active' : ''}
              onClick={() => selectMode('weekly')}
              disabled={!weeklyChallengeAvailable}
              aria-disabled={!weeklyChallengeAvailable}
              title={weeklyChallengeAvailable ? undefined : 'Pas assez de promos sélectionnées pour un défi hebdomadaire'}
            >
              Hebdomadaire
            </button>
            <button type="button" className={mode === 'practice' ? 'is-active' : ''} onClick={() => selectMode('practice')}>Entraînement</button>
          </nav>
          <div className="game-page__actions">
            <button
              className={'game-account-indicator'
                + (accountAuthReady && accountConnected ? ' is-connected' : '')
                + (accountAuthReady && !accountConnected ? ' is-disconnected' : '')}
              type="button"
              aria-label={!accountAuthReady
                ? 'Ouvrir le compte'
                : accountConnected
                  ? 'Compte connecté, ouvrir le compte'
                  : 'Compte non connecté, ouvrir la connexion'}
              title={!accountAuthReady
                ? 'Compte'
                : accountConnected
                  ? 'Compte connecté'
                  : 'Compte non connecté'}
              onClick={() => {
                setMenuOpen(false);
                setSelectedLeaderboardPlayer(null);
                setActivePanel('account');
              }}
            >
              <svg className="game-account-indicator__person" aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                <circle cx="10" cy="6.2" r="3" />
                <path d="M3.5 17c.5-3.3 3-5.3 6.5-5.3s6 2 6.5 5.3" />
              </svg>
              {accountAuthReady && (accountConnected
                ? <CircleCheck className="game-account-indicator__status" aria-hidden="true" size={11} strokeWidth={2.5} />
                : <CircleX className="game-account-indicator__status" aria-hidden="true" size={11} strokeWidth={2.5} />)}
            </button>
            <a className="btn btn--ghost game-page__back" href="#" aria-label="Retour à l’arbre">
              <img className="game-page__back-home-icon" src={houseIcon} alt="" aria-hidden="true" />
              <span className="game-page__back-label"><span aria-hidden="true">←</span> Retour à l’arbre</span>
            </a>
            <div className="game-menu" ref={menuRef}>
              <button
                ref={helpButtonRef}
                className="btn btn--ghost game-menu__trigger"
                type="button"
                aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-expanded={menuOpen}
                aria-controls="game-menu-panel"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg aria-hidden="true" viewBox="0 0 18 18" focusable="false">
                  <path d="M1 4h16M1 9h16M1 14h16" />
                </svg>
              </button>
              {menuOpen && (
                <div className="game-menu__panel" id="game-menu-panel" role="group" aria-label="Menu du jeu">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActivePanel('help');
                    }}
                  >
                    Comment jouer&nbsp;?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setArchiveMode('daily');
                      setArchiveDate(null);
                      setArchiveMonth(new Date(Date.UTC(
                        currentArchiveMonth.getUTCFullYear(),
                        currentArchiveMonth.getUTCMonth(),
                        1
                      )));
                      setActivePanel('archive');
                    }}
                  >
                    Archives
                  </button>
                  <button type="button" onClick={openPromoSettings}>
                    Mode de jeu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setActivePanel('account');
                    }}
                  >
                    Compte
                  </button>
                  {gameSuperadminSession && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setActivePanel('player-admin');
                      }}
                    >
                      Administration
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setSelectedLeaderboardPlayer(null);
                      setActivePanel('leaderboard');
                    }}
                  >
                    Classement
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {awaitingChallengeArchive ? (
          <div className="game-layout">
            <p className="game-challenge-loading" role="status">Préparation du défi…</p>
          </div>
        ) : challenge && start && end ? (
          <div className="game-layout">
            <section className="game-challenge" aria-labelledby="game-challenge-title">
              <div className={'game-challenge__heading'
                + (challenge?.constraint && mode !== 'weekly' ? ' game-challenge__heading--constrained' : '')
                + (mode === 'weekly' ? ' game-challenge__heading--weekly' : '')}>
                <div>
                  {!(archiveSelection?.mode === 'weekly' && mode === 'weekly') && (
                    <p className={'game-section-kicker' + (mode === 'weekly' ? ' game-section-kicker--weekly' : '')}>{pairLabel}</p>
                  )}
                  {mode === 'weekly' && (
                    <p className="game-challenge__schedule">
                      {archiveSelection?.mode === mode
                        ? 'Semaine du ' + formatArchiveDate(challengePeriod)
                        : formatWeeklyReset(challengeClock)}
                    </p>
                  )}
                  <h2 id="game-challenge-title">{challengeQuestion}</h2>
                  {mode === 'weekly' && ruleStudent && (
                    <div className="game-weekly-rule-row">
                      <p className="game-weekly-rule__prompt">
                        {challenge.constraint.type === 'through' ? 'En passant par ' : 'Sans passer par '}
                        <strong>{ruleStudent.name}</strong>
                      </p>
                      <div
                        className={'game-weekly-rule'
                          + (challenge.constraint.type === 'avoid' ? ' game-weekly-rule--avoid' : '')}
                        role="note"
                      >
                        <span className="game-weekly-rule__label">
                          {challenge.constraint.type === 'through' ? 'Obligatoire' : 'Interdit'}
                        </span>
                        <ShapeSwatch promo={ruleStudent.promo} size={14} />
                        <span className="game-weekly-rule__copy">
                          <strong>{ruleStudent.name}</strong>
                          <small>{challenge.constraint.type === 'through'
                            ? 'À inclure dans la chaîne'
                            : 'À ne pas ajouter à la chaîne'}</small>
                        </span>
                      </div>
                    </div>
                  )}
                  {mode === 'daily' && (
                    <p className="game-challenge__schedule">
                      {archiveSelection?.mode === mode
                        ? formatArchiveDate(challengePeriod)
                        : 'Prochain défi dans ' + formatCountdown(getNextParisNoon(challengeClock) - challengeClock.getTime())}
                    </p>
                  )}
                </div>
              </div>
              <div className="game-endpoints">
                <article className="game-endpoint">
                  <ShapeSwatch promo={start.promo} size={25} />
                  <div><small>Départ</small><strong className={endpointNameClass(start.name)}>{start.name}</strong><span>{start.code || 'Promo'}{start.code ? String(start.promo).slice(-2) : ' ' + start.promo}</span></div>
                </article>
                <BrandDivider />
                <article className="game-endpoint">
                  <ShapeSwatch promo={end.promo} size={25} />
                  <div><small>Arrivée</small><strong className={endpointNameClass(end.name)}>{end.name}</strong><span>{end.code || 'Promo'}{end.code ? String(end.promo).slice(-2) : ' ' + end.promo}</span></div>
                </article>
              </div>
              <TopoDivider
                className="game-challenge__divider"
                lineIndex={mode === 'daily' ? 3 : mode === 'weekly' ? 7 : 11}
              />
            </section>

            <section className="game-graph" aria-labelledby="game-graph-title">
              <header className="game-graph__header">
                <div>
                  <p className="game-section-kicker">Graphe du défi</p>
                  <h2 id="game-graph-title">Connexions trouvées</h2>
                </div>
                <div className="game-graph__legend">
                  <span className="game-graph__legend-item"><i aria-hidden="true" /> Lien de famille</span>
                  <span className="game-graph__legend-item"><i className="game-graph__legend-shortest" /> Chemins les plus courts</span>
                  <span className="game-graph__legend-item"><i className="game-graph__legend-off-path" /> Hors chemin</span>
                </div>
              </header>
              <GameGraph
                graph={graph}
                nodes={graphNodes}
                hintNodes={lost ? [] : hintedNodes}
                startId={startId}
                endId={endId}
                requiredId={requiredStudentId}
                forbiddenId={forbiddenStudentId}
                weeklyMode={mode === 'weekly'}
                practiceMode={mode === 'practice'}
                shortestIds={shortestIds}
                shortestEdgeKeys={shortestEdgeKeys}
                possibleIds={graphPossibleIds}
              />
            </section>

            <form className={'game-search' + (searchFocused ? ' is-focused' : '')} onSubmit={handleSubmit}>
              <div className="game-search__label-row">
                <label htmlFor="game-student-search">Ajoute un étudiant pour compléter l'arbre</label>
                <span>({displayedAttemptCount === 1 ? 'Tentative' : 'Tentatives'} {displayedAttemptCount}/{attemptLimit})</span>
              </div>
              <div className="game-search__controls">
                <div className="game-search__input-wrap">
                  <input
                    id="game-student-search"
                    type="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={query}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveSuggestion(0);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Rechercher un étudiant"
                    disabled={won || lost}
                  />
                  {suggestions.length > 0 && searchFocused && !won && !lost && (
                    <ul className="game-search__suggestions" role="listbox">
                      {suggestions.map((student) => {
                        const isForbidden = student.id === forbiddenStudentId;
                        const isActive = !isForbidden
                          && selectableSuggestions[activeSuggestion]?.id === student.id;
                        return (
                          <li key={student.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              disabled={isForbidden}
                              className={(isActive ? 'is-active' : '') + (isForbidden ? ' is-forbidden' : '')}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => addStudent(student)}
                            >
                              <span><NameMatch name={student.name} query={query} className="game-search__match" /></span>
                              <small>{isForbidden
                                ? 'Interdit'
                                : (formatStudentAffiliations(student) || 'Promo ' + student.promo)}</small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <button className="btn btn--ghost game-search__submit" type="submit" disabled={won || lost || !query.trim()}>
                  Ajouter
                </button>
              </div>
            </form>

            <div className={'game-feedback' + (won ? ' game-feedback--won' : lost ? ' game-feedback--lost' : '')} role="status" aria-live="polite">
              {won
                ? <>
                    <span>Bravo ! Tu as trouvé une chaîne de {Math.max(0, winningPath.length - 1)} liens.</span>
                    {mode !== 'practice' && (
                      <strong className={'game-feedback__points' + (anonymousCompletion
                        ? ' game-feedback__points--anonymous'
                        : currentCompletionRecord?.status === 'duplicate' ? ' game-feedback__points--duplicate' : '')}>
                        {anonymousCompletion
                          ? 'Connecte-toi pour gagner des points.'
                          : awaitingSession
                            ? 'Vérification…'
                            : !trackableCompletion
                              ? `+${completionPoints} points`
                              : currentCompletionRecord?.status === 'recorded'
                                ? `+${completionPoints} points`
                                : currentCompletionRecord?.status === 'duplicate'
                                  ? 'Défi déjà réalisé'
                                  : currentCompletionRecord?.status === 'failed'
                                    ? 'Points non confirmés'
                                    : 'Vérification…'}
                      </strong>
                    )}
                  </>
                : lost
                  ? 'Tu as épuisé tes tentatives. Le chemin optimal est révélé sur le graphe.'
                  : feedback || (
                    <>
                      <span className="game-feedback__instruction--desktop">
                        Tu peux choisir parmi les promos sélectionnées <BrandDivider /> les liens montrent lesquels rejoignent la chaîne.
                      </span>
                      <span className="game-feedback__instruction--mobile">
                        Cherche parmi les promos choisies <BrandDivider /> le chemin le plus court
                      </span>
                    </>
                  )}
            </div>

            <div className="game-round-actions">
              <div className="game-hints" role="group" aria-label="Indices">
                {[1, 2, 3].map((hintIndex) => {
                  const used = hintIndex <= hintsUsed;
                  return (
                    <button
                      key={hintIndex}
                      type="button"
                      className={'btn btn--ghost game-hint' + (used ? ' is-used' : '')}
                      disabled={won || lost || hintIndex !== hintsUsed + 1}
                      aria-pressed={used}
                      aria-label={[
                        'Initiales du prochain nœud',
                        'Initiales du dernier nœud avant l’arrivée',
                        'Chemin complet en initiales',
                      ][hintIndex - 1]}
                      onClick={() => {
                        if (hintIndex < 3 && hintPath.length) setHintPathIds(hintPath);
                        if (hintIndex === 1 && nextHintStudent) {
                          setHintedStudentIds([nextHintStudent.id]);
                        }
                        if (hintIndex === 2) {
                          if (previousHintStudent) {
                            setHintedStudentIds((current) => [...new Set([...current, previousHintStudent.id])]);
                          }
                        }
                        setHintsUsed(hintIndex);
                      }}
                    >
                      {['Initiales prochain nœud', 'Initiales dernier nœud', 'Chemin en initiales'][hintIndex - 1]}
                    </button>
                  );
                })}
              </div>
              {mode === 'practice' && (
                <button type="button" className="btn btn--ghost game-round-actions__new-game" onClick={clearRound}>
                  Nouvelle partie
                </button>
              )}
              <div className="game-round-actions__links">
                <span
                  className="game-help-link-tooltip"
                  data-tooltip={!won && hintsUsed < 3 ? 'disponible après indices' : undefined}
                >
                  <button
                    type="button"
                    className="game-help-link game-help-link--button"
                    ref={solutionButtonRef}
                    onClick={() => setActivePanel('solution')}
                    aria-haspopup="dialog"
                    disabled={!won && hintsUsed < 3}
                  >
                    Voir le chemin optimal
                  </button>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <section className="game-empty" role="status">
            <h2>Aucun défi disponible</h2>
            <p>Il faut au moins deux liens entre des étudiants pour créer un défi. Vérifie les liens de parrainage dans la base.</p>
          </section>
        )}

        {activePanel && (
          <div
            className="game-help-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setActivePanel(null);
            }}
          >
            <section
              ref={panelRef}
              className={'game-help-panel'
                + (activePanel === 'solution' ? ' game-help-panel--solution' : '')
                + (activePanel === 'help' ? ' game-help-panel--help' : '')
                + (activePanel === 'game-mode' ? ' game-help-panel--game-mode' : '')
                + (activePanel === 'account' ? ' game-help-panel--account' : '')
                + (activePanel === 'player-admin' ? ' game-help-panel--player-admin' : '')
                + (activePanel === 'leaderboard' ? ' game-help-panel--leaderboard' : '')
                + (activePanel === 'archive' ? ' game-help-panel--archive' : '')}
              role="dialog"
              aria-modal="true"
              aria-labelledby="game-panel-title"
              tabIndex="-1"
            >
              <button
                ref={panelCloseRef}
                type="button"
                className={'game-help-panel__close'
                  + (activePanel === 'help' ? ' game-help-panel__close--help' : '')
                  + (activePanel === 'solution' ? ' game-help-panel__close--solution' : '')}
                onClick={() => setActivePanel(null)}
                aria-label="Fermer le panneau"
              >
                ×
              </button>
              {activePanel === 'help' ? (
                <>
                  <p className="game-section-kicker">Règles</p>
                  <h2 id="game-panel-title">Comment jouer&nbsp;?</h2>
                  <ol>
                    <li>Relie l'étudiant de départ et d'arrivée.</li>
                    <li>Trouve des liens parmi les familles de l'école.</li>
                    <li>Le lien est jaune si c'est le chemin le plus court.</li>
                    <li>Plusieurs chemins peuvent exister.</li>
                    <li>Tu gagnes dès qu'un chemin continu relie le départ et l'arrivée.</li>
                  </ol>
                  <section className="game-help-example game-graph" aria-labelledby="game-help-example-title">
                    <header className="game-graph__header game-help-example__header">
                      <div><h3 id="game-help-example-title">Exemple de parcours</h3></div>
                      <div className="game-graph__legend" aria-label="Légende de l'exemple">
                        <span className="game-graph__legend-item"><i aria-hidden="true" /> Lien de famille</span>
                        <span className="game-graph__legend-item"><i className="game-graph__legend-shortest" aria-hidden="true" /> Chemins les plus courts</span>
                        <span className="game-graph__legend-item"><i className="game-graph__legend-off-path" aria-hidden="true" /> Hors chemin</span>
                      </div>
                    </header>
                    <GameGraph
                      graph={HELP_EXAMPLE_GRAPH}
                      nodes={HELP_EXAMPLE_NODES}
                      startId={HELP_EXAMPLE_START_ID}
                      endId={HELP_EXAMPLE_END_ID}
                      requiredId={null}
                      shortestIds={HELP_EXAMPLE_SHORTEST_IDS}
                      shortestEdgeKeys={HELP_EXAMPLE_SHORTEST_EDGE_KEYS}
                      possibleIds={HELP_EXAMPLE_POSSIBLE_IDS}
                      orderedIds={HELP_EXAMPLE_ORDERED_IDS}
                      elasticDrag
                      ariaLabel="Graphe d'exemple"
                    />
                  </section>
                </>
              ) : activePanel === 'game-mode' ? (
                <>
                  <p className="game-section-kicker">Mode de jeu</p>
                  <h2 id="game-panel-title">Promos jouables</h2>
                  <p className="game-promo-settings__intro">
                    Seuls les étudiants et les liens des promos sélectionnées pourront apparaître dans les défis.
                  </p>
                  <div className="game-promo-settings__select-actions">
                    <button type="button" onClick={() => setPromoDraft([...availablePromoYears])}>
                      Tout sélectionner
                    </button>
                    <button type="button" onClick={() => setPromoDraft([])}>
                      Tout désélectionner
                    </button>
                  </div>
                  <div
                    className="game-promo-settings__list"
                    role="group"
                    aria-label="Promos utilisables dans le jeu"
                  >
                    {promoPages.map((page, pageIndex) => (
                      <div className="game-promo-settings__page" key={pageIndex}>
                        {page.map((promo) => {
                          const selected = draftPromoSet.has(promo);
                          return (
                            <label
                              key={promo}
                              className={'game-promo-settings__option' + (selected ? ' is-selected' : '')}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleDraftPromo(promo)}
                              />
                              <span>
                                <strong>{describePromo(promo, challengeClock).label}</strong>
                                <small>Promo {promo}</small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <p className="game-promo-settings__status" role="status" aria-live="polite">
                    {draftPromoYears.length < 3
                      ? 'Sélectionne au moins trois promos pour jouer.'
                      : promoDraftCanPlay
                        ? 'Le jeu sera limité aux promos sélectionnées.'
                        : 'Cette sélection ne permet pas de relier deux étudiants par un chemin de jeu.'}
                  </p>
                  <div className="game-promo-settings__footer">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setPromoDraft(null);
                        setActivePanel(null);
                      }}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={applyPromoSettings}
                      disabled={!promoDraftCanPlay}
                    >
                      Appliquer
                    </button>
                  </div>
                </>
              ) : activePanel === 'player-admin' ? (
                <>
                  <p className="game-section-kicker">Superadmin</p>
                  <h2 id="game-panel-title">Gestion des comptes</h2>
                  <PlayerAccountAdminPanel
                    session={gameSuperadminSession}
                    onSession={setGameSuperadminSession}
                  />
                </>
              ) : activePanel === 'account' ? (
                <>
                  <div className="game-account-panel__eyebrow">
                    <p className="game-section-kicker">Espace joueur</p>
                  </div>
                  <h2 id="game-panel-title">{accountAuthReady ? (accountConnected ? 'Mon compte' : 'Connexion') : 'Compte'}</h2>
                  <PlayerAccountPanel
                    initialMode={accountInitialMode}
                    onInitialModeReset={() => setAccountInitialMode('login')}
                    onConnectionChange={setAccountConnected}
                    onAuthReady={() => setAccountAuthReady(true)}
                    knownAuthReady={accountAuthReady}
                    knownUser={accountAuthUser}
                  />
                </>
              ) : activePanel === 'leaderboard' ? (
                selectedLeaderboardPlayer ? (
                  <>
                    <p className="game-section-kicker">Profil joueur</p>
                    <h2 id="game-panel-title" className="game-leaderboard__profile-pseudo">{selectedLeaderboardPlayer.pseudo}</h2>
                    <div className="game-leaderboard__profile-school">
                      <span className="game-leaderboard__profile-name">{selectedLeaderboardPlayer.firstName} {selectedLeaderboardPlayer.lastName}</span>
                      <span>{selectedLeaderboardPlayer.promo}</span>
                      {selectedLeaderboardPlayer.filiere && (
                        <>
                          <BrandDivider />
                          <span>{selectedLeaderboardPlayer.filiere}</span>
                        </>
                      )}
                    </div>
                    {selectedLeaderboardPlayer.bio && (
                      <p className="game-leaderboard__profile-bio">{selectedLeaderboardPlayer.bio}</p>
                    )}
                    <div className="game-leaderboard__profile-stats" aria-label={'Statistiques de ' + selectedLeaderboardPlayer.pseudo}>
                      <div><strong>{selectedLeaderboardPlayer.daily}</strong><span>Défis quotidiens</span></div>
                      <div><strong>{selectedLeaderboardPlayer.weekly}</strong><span>Défis hebdomadaires</span></div>
                      <div><strong>{selectedLeaderboardPlayer.score.toLocaleString('fr-FR')}</strong><span>Points</span></div>
                    </div>
                    <button type="button" className="game-leaderboard__back" onClick={() => setSelectedLeaderboardPlayer(null)}>← Retour au classement</button>
                  </>
                ) : (
                  <>
                    <p className="game-section-kicker">Scores des joueurs</p>
                    <h2 id="game-panel-title">Classement</h2>
                    <p className="game-leaderboard__intro">Classement actualisé à partir des défis réussis.</p>
                    {leaderboardLoading && <p className="game-leaderboard__status" role="status">Chargement du classement…</p>}
                    {leaderboardError && <p className="game-leaderboard__status game-leaderboard__status--error" role="alert">{leaderboardError}</p>}
                    {!leaderboardLoading && !leaderboardError && leaderboardPlayers.length === 0 && (
                      <p className="game-leaderboard__status">Aucun joueur inscrit pour le moment.</p>
                    )}
                    {leaderboardPlayers.length > 0 && <ol className="game-leaderboard" aria-label="Classement des joueurs">
                      {leaderboardPlayers.map((player, index) => (
                        <li className={index < 3 ? 'game-leaderboard__row game-leaderboard__row--top' : 'game-leaderboard__row'} key={player.pseudo}>
                          <button
                            type="button"
                            className="game-leaderboard__open"
                            aria-label={'Voir le profil et les statistiques de ' + player.pseudo}
                            onClick={() => {
                              if (player.isCurrentUser) {
                                setSelectedLeaderboardPlayer(null);
                                setActivePanel('account');
                              } else {
                                setSelectedLeaderboardPlayer(player);
                              }
                            }}
                          >
                            <span className="game-leaderboard__rank">{index + 1}</span>
                            <span className="game-leaderboard__pseudo">{player.pseudo}</span>
                            <strong className="game-leaderboard__score">{player.score.toLocaleString('fr-FR')} pts</strong>
                          </button>
                        </li>
                      ))}
                    </ol>}
                  </>
                )
              ) : activePanel === 'archive' ? (
                <>
                  <p className="game-section-kicker">Archives</p>
                  <h2 id="game-panel-title">Anciens défis</h2>
                  <p className="game-archive__intro">Choisis un défi quotidien ou hebdomadaire à rejouer.</p>
                  <p className="game-archive__note">
                    Chaque défi se joue sur le graphe d’époque : un lien renseigné aujourd’hui
                    n’existait pas forcément à la date de l’archive.
                  </p>

                  <div className="game-archive__modes" role="group" aria-label="Type de défi archivé">
                    <button
                      type="button"
                      className={archiveMode === 'daily' ? 'is-active' : ''}
                      aria-pressed={archiveMode === 'daily'}
                      onClick={() => {
                        setArchiveMode('daily');
                        setArchiveDate(null);
                      }}
                    >
                      Journalier
                    </button>
                    <button
                      type="button"
                      className={archiveMode === 'weekly' ? 'is-active' : ''}
                      aria-pressed={archiveMode === 'weekly'}
                      onClick={() => {
                        setArchiveMode('weekly');
                        setArchiveDate(null);
                      }}
                    >
                      Hebdomadaire
                    </button>
                  </div>

                  <div className="game-archive__calendar">
                    <div className="game-archive__month">
                      <button
                        type="button"
                        aria-label="Mois précédent"
                        disabled={!canGoToPreviousArchiveMonth}
                        onClick={() => {
                          setArchiveDate(null);
                          setArchiveMonth((current) => new Date(Date.UTC(
                            current.getUTCFullYear(),
                            current.getUTCMonth() - 1,
                            1
                          )));
                        }}
                      >
                        ‹
                      </button>
                      <h3 aria-live="polite">{formatArchiveMonth(archiveMonth)}</h3>
                      <button
                        type="button"
                        aria-label="Mois suivant"
                        disabled={!canAdvanceArchiveMonth}
                        onClick={() => {
                          setArchiveDate(null);
                          setArchiveMonth((current) => new Date(Date.UTC(
                            current.getUTCFullYear(),
                            current.getUTCMonth() + 1,
                            1
                          )));
                        }}
                      >
                        ›
                      </button>
                    </div>
                    <div className="game-archive__weekdays" aria-hidden="true">
                      {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="game-archive__days">
                      {archiveCalendarCells.map((cell, index) => {
                        if (!cell) {
                          return <span className="game-archive__empty-day" key={'empty-' + index} aria-hidden="true" />;
                        }
                        const selected = archiveDate === cell.periodKey;
                        const archiveLabel = (archiveMode === 'weekly' ? 'Semaine du ' : 'Défi du ')
                          + formatArchiveDate(cell.periodKey)
                          + (cell.isToday ? ' (aujourd’hui)' : '')
                          + (cell.completed ? ' (défi déjà réalisé, rejouable sans points)' : '');
                        return (
                          <button
                            key={cell.periodKey}
                            type="button"
                            className={'game-archive__day'
                              + (cell.available ? ' is-available' : '')
                              + (cell.isToday ? ' is-today' : '')
                              + (cell.completed ? ' is-completed' : '')
                              + (selected ? ' is-selected' : '')}
                            disabled={!cell.available}
                            aria-label={archiveLabel}
                            title={cell.completed ? 'Défi déjà réalisé · Rejouable sans points' : undefined}
                            aria-pressed={selected}
                            onClick={() => {
                              const isCurrentChallenge = archiveMode === 'daily'
                                ? cell.isToday
                                : cell.periodKey === currentWeeklyPeriod;
                              const selectedPeriod = isCurrentChallenge
                                ? archiveMode === 'daily' ? currentDailyPeriod : currentWeeklyPeriod
                                : cell.periodKey;
                              const scope = [...playablePromoYears].sort((a, b) => a - b);
                              if (isCurrentChallenge && mode === archiveMode && !archiveSelection) {
                                setActivePanel(null);
                                setMenuOpen(false);
                              } else {
                                selectMode(archiveMode, isCurrentChallenge
                                  ? null
                                  : { mode: archiveMode, periodKey: selectedPeriod, promoYears: scope });
                              }
                              archiveChallengeForPeriod(archiveMode, selectedPeriod, scope).catch((error) => {
                                console.warn('[défis] Impossible de charger cette archive :', error.message);
                              });
                            }}
                          >
                            {cell.day}
                          </button>
                        );
                      })}
                    </div>
                    <p className="game-archive__hint game-archive__hint--range">
                      {archiveMode === 'daily'
                        ? 'Défis quotidiens disponibles depuis le 1er septembre 2026.'
                        : 'Défis hebdomadaires disponibles depuis le 1er septembre 2026.'}
                    </p>
                  </div>

                  {archiveDate && (!archiveChallenge || !archiveStart || !archiveEnd) && (
                    <p className="game-archive__hint" aria-live="polite">
                      Ce défi n’est pas disponible avec les données actuelles.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="game-section-kicker">Solution</p>
                  <h2 id="game-panel-title">{challenge?.constraint ? 'Solution du défi' : 'Chemin le plus court'}</h2>
                  <p className="game-solution__summary">
                    {Math.max(0, shortestPath.length - 1)} liens
                    {challenge?.constraint ? ' en respectant la consigne' : ' entre le départ et l’arrivée'}
                  </p>
                  <p className="game-solution__note">
                    {challenge?.constraint
                      ? 'Il peut exister d’autres chemins aussi courts qui respectent la consigne.'
                      : 'Il peut exister d’autres chemins aussi courts.'}
                  </p>
                  {challenge?.constraint && ruleStudent && (
                    <div
                      className={'game-solution__rule'
                        + (challenge.constraint.type === 'avoid' ? ' game-solution__rule--avoid' : '')}
                      role="note"
                    >
                      <span className="game-solution__rule-label">
                        {challenge.constraint.type === 'through' ? 'Obligatoire' : 'Interdit'}
                      </span>
                      <ShapeSwatch promo={ruleStudent.promo} size={18} />
                      <span className="game-solution__rule-copy">
                        <strong>{ruleStudent.name}</strong>
                        <small>{challenge.constraint.type === 'through'
                          ? 'À inclure dans la chaîne'
                          : 'À ne pas ajouter à la chaîne'}</small>
                      </span>
                    </div>
                  )}
                  <GameGraph
                    graph={solutionGraph}
                    nodes={solutionNodes}
                    startId={startId}
                    endId={endId}
                    requiredId={requiredStudentId}
                    forbiddenId={forbiddenStudentId}
                    weeklyMode={mode === 'weekly'}
                    shortestIds={shortestIds}
                    shortestEdgeKeys={shortestPathEdgeKeys}
                    possibleIds={solutionPossibleIds}
                    orderedIds={shortestPath}
                    solutionLayout
                    ariaLabel={challenge?.constraint ? 'Graphe de la solution du défi' : 'Graphe du chemin le plus court'}
                  />
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
