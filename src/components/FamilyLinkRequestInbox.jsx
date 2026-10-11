import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { deleteFamilyLinkRequest, fetchFamilyLinkRequests, updateFamilyLinkRequest } from '../lib/supabase';
import { accountErrorMessage } from '../lib/playerAccounts';

const FILTERS = [
  { id: 'pending', label: 'À traiter' },
  { id: 'resolved', label: 'Traitées' },
  { id: 'dismissed', label: 'Ignorées' },
  { id: 'all', label: 'Toutes' },
];

const STATUS_LABELS = {
  pending: 'À traiter',
  resolved: 'Traitée',
  dismissed: 'Ignorée',
};

function formatRequestDate(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function deleteRequestErrorMessage(error) {
  if (error?.code === 'PGRST202' || /could not find the function .*delete_family_link_request|delete_family_link_request.*schema cache/i.test(error?.message ?? '')) {
    return 'La suppression n’est pas encore installée dans Supabase. Exécute le script supabase/delete_family_link_request.sql dans le SQL Editor.';
  }
  if (error?.code === '42501' || error?.status === 401 || error?.status === 403) {
    return 'La session superadmin a expiré ou n’a pas les droits nécessaires. Reconnecte-toi puis réessaie.';
  }
  if (error?.code === 'P0002') {
    return 'Cette demande n’existe plus. Actualise la liste puis réessaie.';
  }
  return accountErrorMessage(error);
}

export default function FamilyLinkRequestInbox({ session, onSession, onValidate, onPendingRequestCountChange }) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [successKind, setSuccessKind] = useState('resolved');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchFamilyLinkRequests(sessionRef.current);
      onSession(result.session);
      setRequests(result.requests);
      onPendingRequestCountChange?.(result.requests.filter((request) => request.status === 'pending').length);
    } catch (loadError) {
      setError(`Impossible de charger les demandes : ${accountErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [onPendingRequestCountChange, onSession]);

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
      if (nextStatus === 'resolved') {
        const validation = await onValidate(request, activeSession);
        activeSession = validation?.session ?? activeSession;
      }
      const result = await updateFamilyLinkRequest(request.id, nextStatus, activeSession);
      onSession(result.session);
      const nextRequests = requests.map((currentRequest) => (
        currentRequest.id === request.id ? result.request : currentRequest
      ));
      setRequests(nextRequests);
      onPendingRequestCountChange?.(nextRequests.filter((currentRequest) => currentRequest.status === 'pending').length);
      setSuccessKind(nextStatus);
      setSuccess(nextStatus === 'resolved'
        ? 'Requête validée. Le lien a été ajouté au graphe.'
        : nextStatus === 'dismissed'
          ? 'Requête ignorée.'
          : 'Requête remise à traiter.');
    } catch (updateError) {
      setError(`Impossible de modifier cette demande : ${accountErrorMessage(updateError)}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteRequest = async (request) => {
    const confirmed = window.confirm(
      `Supprimer définitivement la proposition « ${request.child_name} est le fillot ou la fillotte de ${request.parent_name} » ?`
    );
    if (!confirmed) return;

    setBusyId(request.id);
    setError('');
    setSuccess('');
    try {
      const result = await deleteFamilyLinkRequest(request.id, session);
      onSession(result.session);
      const nextRequests = requests.filter((currentRequest) => currentRequest.id !== request.id);
      setRequests(nextRequests);
      onPendingRequestCountChange?.(nextRequests.filter((currentRequest) => currentRequest.status === 'pending').length);
      setSuccessKind('deleted');
      setSuccess('Requête supprimée.');
    } catch (deleteError) {
      setError(`Impossible de supprimer cette demande : ${deleteRequestErrorMessage(deleteError)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="family-request-inbox" aria-labelledby="family-requests-title">
      <header className="family-request-inbox__header">
        <div>
          <h3 id="family-requests-title">Propositions envoyées depuis le site</h3>
          <p>Les liens sont ajoutés à l’arbre après validation.</p>
        </div>
        <button
          className={`family-request-inbox__refresh${loading ? ' is-loading' : ''}`}
          type="button"
          onClick={refresh}
          disabled={loading || busyId !== null}
          aria-label={loading ? 'Actualisation des requêtes…' : 'Actualiser les requêtes'}
          title="Actualiser"
        >
          <RefreshCw className="family-request-inbox__refresh-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <div className="family-request-inbox__filters" role="group" aria-label="Filtrer les propositions">
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
      {success && (
        <p className={`admin-message admin-message--success family-request-inbox__feedback family-request-inbox__feedback--${successKind}`} role="status">
          {success}
        </p>
      )}
      {loading && requests.length === 0 ? (
        <p className="family-request-inbox__empty">Chargement des propositions…</p>
      ) : visibleRequests.length === 0 ? (
        <p className="family-request-inbox__empty">Aucune proposition dans cette catégorie.</p>
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
              <p><strong>{request.child_name}</strong> est le fillot ou la fillotte de <strong>{request.parent_name}</strong>.</p>
              {request.message && <blockquote>{request.message}</blockquote>}
              {Array.isArray(request.additional_reports) && request.additional_reports.length > 0 && (
                <div className="family-request-inbox__reports">
                  <p className="family-request-inbox__reports-title">
                    Informations complémentaires ({request.additional_reports.length})
                  </p>
                  <ul className="family-request-inbox__reports-list">
                    {request.additional_reports.map((report) => (
                      <li key={report.id}>
                        <time dateTime={report.created_at}>{formatRequestDate(report.created_at)}</time>
                        <blockquote>{report.message}</blockquote>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="family-request-inbox__actions">
                {request.status === 'pending' ? (
                  <>
                    <button type="button" onClick={() => changeStatus(request, 'resolved')} disabled={busyId !== null}>
                      Valider
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
                  aria-label={`Supprimer la proposition de ${request.child_name} vers ${request.parent_name}`}
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
