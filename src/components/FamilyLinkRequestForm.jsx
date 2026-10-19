import { useEffect, useMemo, useRef, useState } from 'react';
import { searchStudentsByName } from '../lib/studentSearch';
import { notifyFamilyLinkRequestByEmail, submitFamilyLinkRequest } from '../lib/supabase';
import { accountErrorMessage } from '../lib/playerAccounts';

const idOf = (endpoint) => (typeof endpoint === 'object' ? endpoint?.id : endpoint);

function StudentPicker({ id, label, placeholder, students, value, onChange, onInteraction }) {
  const rootRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = students.find((student) => student.id === value);
  const results = useMemo(
    () => (query.trim() ? searchStudentsByName(students, query).slice(0, 7) : []),
    [students, query]
  );

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const choose = (student) => {
    if (!student) return;
    onChange(student.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="family-request__picker" ref={rootRef}>
      <label htmlFor={id}>{label}</label>
      {selected ? (
        <div className="family-request__picked-student">
          <strong>{selected.name}</strong>
          <button type="button" onClick={() => onChange('')}>Changer</button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && results.length > 0}
            aria-controls={`${id}-options`}
            aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              onInteraction?.();
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % results.length);
              } else if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + results.length) % results.length);
              } else if (event.key === 'Enter' && results.length) {
                event.preventDefault();
                choose(results[activeIndex] ?? results[0]);
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {open && results.length > 0 && (
            <ul className="family-request__suggestions" id={`${id}-options`} role="listbox" aria-label={label}>
              {results.map((student, index) => (
                <li key={student.id}>
                  <button
                    type="button"
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={student.id === value}
                    className={index === activeIndex ? 'is-active' : ''}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(student)}
                  >
                    <span>{student.name}</span>
                    <small>Promo {student.promo}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function FamilyLinkRequestForm({ students, links = [] }) {
  const [childId, setChildId] = useState('');
  const [parentId, setParentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const child = students.find((student) => student.id === childId);
  const parent = students.find((student) => student.id === parentId);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeoutId = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  const clearFeedback = () => setFeedback(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!child || !parent || child.id === parent.id || busy) return;
    if (links.some((link) => idOf(link.source) === parent.id && idOf(link.target) === child.id)) {
      setFeedback({ type: 'error', text: 'Ce lien existe déjà dans le graphe.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const savedRequest = await submitFamilyLinkRequest({ child, parent, message });
      if (savedRequest?.existing_link) {
        setFeedback({ type: 'error', text: 'Ce lien existe déjà dans le graphe.' });
        return;
      }
      if (savedRequest?.duplicate) {
        if (!savedRequest.message_received) {
          setFeedback({
            type: 'success',
            text: 'Cette proposition est déjà en attente. Tu peux ajouter un message avec des informations complémentaires pour le BDE.',
          });
          return;
        }

        if (savedRequest.message_already_sent) {
          setChildId('');
          setParentId('');
          setMessage('');
          setFeedback({
            type: 'success',
            text: 'Cette proposition est déjà en attente. Ces informations ont déjà été transmises au BDE.',
          });
          return;
        }

        if (!savedRequest.report_id) {
          setFeedback({
            type: 'error',
            text: 'Cette proposition est déjà en attente. Ton message est enregistré, mais l’e-mail n’a pas pu être préparé ; le BDE le retrouvera dans l’administration.',
          });
          return;
        }

        try {
          const notification = await notifyFamilyLinkRequestByEmail(
            savedRequest.id,
            child,
            parent,
            savedRequest.report_id
          );
          if (!notification?.sent) throw new Error('La notification n’a pas été envoyée.');
          setChildId('');
          setParentId('');
          setMessage('');
          setFeedback({
            type: 'success',
            text: 'Cette proposition est déjà en attente. Ton message complémentaire a été transmis au BDE.',
          });
        } catch {
          setFeedback({
            type: 'error',
            text: 'Cette proposition est déjà en attente. Ton message complémentaire est enregistré, mais l’alerte e-mail n’a pas pu être envoyée ; le BDE le retrouvera dans l’administration.',
          });
        }
        return;
      }

      try {
        const notification = await notifyFamilyLinkRequestByEmail(savedRequest.id, child, parent);
        if (!notification?.sent) throw new Error('La notification n’a pas été envoyée.');
        setChildId('');
        setParentId('');
        setMessage('');
        setFeedback({ type: 'success', text: 'Merci, ta proposition a été enregistrée et le BDE a été averti par e-mail.' });
      } catch {
        setFeedback({
          type: 'error',
          text: 'Ta proposition est enregistrée, mais l’alerte e-mail n’a pas pu être envoyée. Le BDE la retrouvera dans l’administration.',
        });
      }
    } catch (error) {
      const unavailable = /submit_family_link_request|schema cache|404|not found/i.test(error.message);
      setFeedback({
        type: 'error',
        text: unavailable
          ? 'Le service de demandes n’est pas encore activé. Réessaie un peu plus tard.'
          : `L’envoi a échoué : ${accountErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="family-request" onSubmit={handleSubmit}>
      <p className="family-request__intro">Le BDE vérifiera la proposition avant toute modification du graphe.</p>
      <StudentPicker
        id="family-request-parent"
        label="Qui est le parrain ou la marraine ?"
        placeholder="Rechercher le parrain ou la marraine"
        students={students}
        value={parentId}
        onChange={(value) => {
          clearFeedback();
          setParentId(value);
        }}
        onInteraction={clearFeedback}
      />
      <StudentPicker
        id="family-request-child"
        label="De qui ?"
        placeholder="Rechercher le fillot ou la fillotte"
        students={students}
        value={childId}
        onChange={(value) => {
          clearFeedback();
          setChildId(value);
        }}
        onInteraction={clearFeedback}
      />
      <label className="family-request__message-label" htmlFor="family-request-message">
        Message <span>(facultatif)</span>
      </label>
      <textarea
        id="family-request-message"
        value={message}
        maxLength={1500}
        rows={3}
        placeholder="Ajoute un détail utile à la vérification…"
        onChange={(event) => {
          clearFeedback();
          setMessage(event.target.value);
        }}
      />
      {feedback && <p className={`family-request__feedback family-request__feedback--${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
      <button className="btn family-request__submit" type="submit" disabled={busy || !child || !parent || child.id === parent.id}>
        {busy ? 'Envoi…' : 'Envoyer la proposition'}
      </button>
    </form>
  );
}
