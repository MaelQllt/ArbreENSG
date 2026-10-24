import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { deleteStudentAdditionRequest, fetchStudentAdditionRequests, updateStudentAdditionRequest } from '../lib/supabase';
import { accountErrorMessage } from '../lib/playerAccounts';
import { formatCodeYear } from '../lib/promo';

const FILTERS = [
  { id: 'pending', label: 'À traiter' },
  { id: 'resolved', label: 'Ajoutées' },
  { id: 'dismissed', label: 'Ignorées' },
  { id: 'all', label: 'Toutes' },
];

const STATUS_LABELS = {
  pending: 'À traiter',
  resolved: 'Ajoutée',
  dismissed: 'Ignorée',
};

const formatRequestDate = (value) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

function loadErrorMessage(error) {
  if (error?.code === 'PGRST202' || /list_student_addition_requests/.test(error?.message ?? '')) {
    return 'Les demandes « Une personne manque » ne sont pas encore installées dans Supabase. Exécute le script supabase/student_addition_requests.sql dans le SQL Editor.';
  }
  return `Impossible de charger les demandes : ${accountErrorMessage(error)}`;
}

/** Demandes « Une personne manque », dans l'écran « À traiter » de l'admin. */
export default function StudentAdditionRequestInbox({ session, onSession, onValidate, onPendingCountChange }) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const publish = useCallback((nextRequests) => {
    setRequests(nextRequests);
    onPendingCountChange?.(nextRequests.filter((request) => request.status === 'pending').length);
  }, [onPendingCountChange]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchStudentAdditionRequests(sessionRef.current);
      onSession(result.session);
      publish(result.requests);
    } catch (loadError) {
      setError(loadErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [onSession, publish]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!success) return undefined;
    const timeout = window.setTimeout(() => setSuccess(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [success]);

  const visibleRequests = useMemo(
    () => filter === 'all' ? requests : requests.filter((request) => request.status === filter),
    [requests, filter]
  );

  const changeStatus = async (request, nextStatus) => {
    setBusyId(request.id);
    setError('');
    setSuccess('');
    try {
      let activeSession = session;
      let note = '';
      if (nextStatus === 'resolved') {
        const validation = await onValidate(request, activeSession);
        activeSession = validation?.session ?? activeSession;
        note = validation?.note ?? '';
      }
      const result = await updateStudentAdditionRequest(request.id, nextStatus, activeSession);
      onSession(result.session);
      publish(requests.map((current) => current.id === request.id ? result.request : current));
      setSuccess(nextStatus === 'resolved'
        ? `${request.first_name} ${request.last_name} a été ajouté·e à l’arbre.${note ? ` ${note}` : ''}`
        : nextStatus === 'dismissed' ? 'Demande ignorée.' : 'Demande remise à traiter.');
    } catch (updateError) {
      setError(`Impossible de traiter cette demande : ${accountErrorMessage(updateError)}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteRequest = async (request) => {
    if (!window.confirm(`Supprimer définitivement la demande pour ${request.first_name} ${request.last_name} ?`)) return;
    setBusyId(request.id);
    setError('');
    setSuccess('');
    try {
      const result = await deleteStudentAdditionRequest(request.id, session);
      onSession(result.session);
      publish(requests.filter((current) => current.id !== request.id));
      setSuccess('Demande supprimée.');
    } catch (deleteError) {
      setError(`Impossible de supprimer cette demande : ${accountErrorMessage(deleteError)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="family-request-inbox" aria-labelledby="student-requests-title">
      <header className="family-request-inbox__header">
        <div>
          <h3 id="student-requests-title">Personnes à ajouter</h3>
          <p>Signalées depuis le site. Valider ajoute la personne à l’arbre, avec son parrain s’il est indiqué.</p>
        </div>
        <button
          className={`family-request-inbox__refresh${loading ? ' is-loading' : ''}`}
          type="button"
          onClick={refresh}
          disabled={loading || busyId !== null}
          aria-label={loading ? 'Actualisation des demandes…' : 'Actualiser les demandes'}
          title="Actualiser"
        >
          <RefreshCw className="family-request-inbox__refresh-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <div className="family-request-inbox__filters" role="group" aria-label="Filtrer les demandes">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? 'is-active' : ''}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
            {option.id === 'pending' && <span>{requests.filter((request) => request.status === 'pending').length}</span>}
          </button>
        ))}
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {success && <p className="admin-message admin-message--success" role="status">{success}</p>}
      {loading && requests.length === 0 ? (
        <p className="family-request-inbox__empty">Chargement des demandes…</p>
      ) : visibleRequests.length === 0 ? (
        <p className="family-request-inbox__empty">Aucune demande dans cette catégorie.</p>
      ) : (
        <ul className="family-request-inbox__list">
          {visibleRequests.map((request) => (
            <li className="family-request-inbox__item" key={request.id}>
              <div className="family-request-inbox__meta">
                <span className={`family-request-inbox__status family-request-inbox__status--${request.status}`}>
                  {STATUS_LABELS[request.status] ?? request.status}
                </span>
                <time dateTime={request.created_at}>{formatRequestDate(request.created_at)}</time>
              </div>
              <p>
                <strong>{request.first_name} {request.last_name}</strong>
                {' '}({formatCodeYear(request.code, request.promo) || `promo ${request.promo}`})
                {request.parent_name
                  ? <>, fillot ou fillotte de <strong>{request.parent_name}</strong>.</>
                  : <>, sans parrain indiqué.</>}
              </p>
              {request.message && <blockquote>{request.message}</blockquote>}
              <div className="family-request-inbox__actions">
                {request.status === 'pending' ? (
                  <>
                    <button type="button" onClick={() => changeStatus(request, 'resolved')} disabled={busyId !== null}>
                      Ajouter à l’arbre
                    </button>
                    <button type="button" onClick={() => changeStatus(request, 'dismissed')} disabled={busyId !== null}>
                      Ignorer
                    </button>
                  </>
                ) : (
                  <button
                    className="family-request-inbox__restore"
                    type="button"
                    onClick={() => changeStatus(request, 'pending')}
                    disabled={busyId !== null}
                  >
                    <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
                    <span>Remettre à traiter</span>
                  </button>
                )}
                <button
                  className="family-request-inbox__delete"
                  type="button"
                  onClick={() => deleteRequest(request)}
                  disabled={busyId !== null}
                  aria-label={`Supprimer la demande pour ${request.first_name} ${request.last_name}`}
                  title="Supprimer définitivement"
                >
                  <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>Supprimer</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
