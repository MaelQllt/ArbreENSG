import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { deleteFamilyLinkRequest, fetchFamilyLinkRequests, updateFamilyLinkRequest } from '../lib/supabase';

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

export default function FamilyLinkRequestInbox({ session, onSession, onValidate }) {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchFamilyLinkRequests(session);
      onSession(result.session);
      setRequests(result.requests);
    } catch (loadError) {
      setError(`Impossible de charger les demandes : ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, [onSession, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRequests = useMemo(
    () => filter === 'all' ? requests : requests.filter((request) => request.status === filter),
    [requests, filter]
  );

  const changeStatus = async (request, nextStatus) => {
    setBusyId(request.id);
    setError('');
    try {
      let activeSession = session;
      if (nextStatus === 'resolved') {
        const validation = await onValidate(request, activeSession);
        activeSession = validation?.session ?? activeSession;
      }
      const result = await updateFamilyLinkRequest(request.id, nextStatus, activeSession);
      onSession(result.session);
      setRequests((current) => current.map((currentRequest) => (
        currentRequest.id === request.id ? result.request : currentRequest
      )));
    } catch (updateError) {
      setError(`Impossible de modifier cette demande : ${updateError.message}`);
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
    try {
      const result = await deleteFamilyLinkRequest(request.id, session);
      onSession(result.session);
      setRequests((current) => current.filter((currentRequest) => currentRequest.id !== request.id));
    } catch (deleteError) {
      setError(`Impossible de supprimer cette demande : ${deleteError.message}`);
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
