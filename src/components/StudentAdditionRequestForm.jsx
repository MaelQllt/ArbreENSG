import { useEffect, useMemo, useState } from 'react';
import { academicYearStart } from '../lib/promo';
import { normalizeStudentSearch } from '../lib/studentSearch';
import { notifyStudentAdditionRequestByEmail, submitStudentAdditionRequest } from '../lib/supabase';
import { accountErrorMessage } from '../lib/playerAccounts';
import { StudentPicker } from './FamilyLinkRequestForm';

const CODES = [
  { value: 'ING', label: 'ING · ingénieur' },
  { value: 'LG', label: 'LG · licence géomètre' },
  { value: 'M', label: 'M · master' },
];

const nameKey = (value) => normalizeStudentSearch(value).split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');

/** « Une personne manque » : un visiteur signale un étudiant absent de l'arbre. */
export default function StudentAdditionRequestForm({ students }) {
  const currentPromo = academicYearStart();
  const years = useMemo(
    () => Array.from({ length: currentPromo - 2014 }, (_, index) => currentPromo - index),
    [currentPromo]
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [promo, setPromo] = useState('');
  const [code, setCode] = useState('');
  const [parentId, setParentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const parent = students.find((student) => student.id === parentId);
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const alreadyThere = useMemo(() => {
    if (!firstName.trim() || !lastName.trim()) return null;
    const key = nameKey(fullName);
    return students.find((student) => nameKey(student.name) === key) ?? null;
  }, [students, firstName, lastName, fullName]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeoutId = window.setTimeout(() => setFeedback(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  const edit = (setter) => (event) => {
    setFeedback(null);
    setter(event.target.value);
  };

  const reset = () => {
    setFirstName('');
    setLastName('');
    setPromo('');
    setCode('');
    setParentId('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy || !firstName.trim() || !lastName.trim() || !promo || !code || alreadyThere) return;
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await submitStudentAdditionRequest({
        firstName: firstName.trim(),
        lastName: lastName.trim().toLocaleUpperCase('fr'),
        promo: Number(promo),
        code,
        parent,
        message,
      });
      if (saved?.duplicate) {
        reset();
        setFeedback({ type: 'success', text: `${fullName} a déjà été signalé·e : la demande est en attente auprès du BDE.` });
        return;
      }
      try {
        const notification = await notifyStudentAdditionRequestByEmail(saved.id);
        if (!notification?.sent) throw new Error('La notification n’a pas été envoyée.');
        reset();
        setFeedback({ type: 'success', text: 'Merci, ta demande a été enregistrée et le BDE a été averti par e-mail.' });
      } catch {
        reset();
        setFeedback({
          type: 'error',
          text: 'Ta demande est enregistrée, mais l’alerte e-mail n’a pas pu être envoyée. Le BDE la retrouvera dans l’administration.',
        });
      }
    } catch (error) {
      const unavailable = /submit_student_addition_request|schema cache|404|not found/i.test(error.message);
      setFeedback({
        type: 'error',
        text: unavailable
          ? 'Ce type de demande n’est pas encore activé. Réessaie un peu plus tard.'
          : `L’envoi a échoué : ${accountErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="family-request" onSubmit={handleSubmit}>
      <p className="family-request__intro">Le BDE vérifiera la demande avant d’ajouter la personne à l’arbre.</p>
      <div className="family-request__row">
        <div className="family-request__picker">
          <label htmlFor="student-request-first-name">Prénom</label>
          <input
            id="student-request-first-name"
            value={firstName}
            maxLength={100}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={edit(setFirstName)}
            placeholder="Ex. Camille"
          />
        </div>
        <div className="family-request__picker">
          <label htmlFor="student-request-last-name">Nom</label>
          <input
            id="student-request-last-name"
            value={lastName}
            maxLength={100}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setFeedback(null);
              setLastName(event.target.value.toLocaleUpperCase('fr'));
            }}
            placeholder="Ex. MARTIN"
          />
        </div>
      </div>
      {alreadyThere && (
        <p className="family-request__feedback family-request__feedback--error" role="alert">
          {alreadyThere.name} est déjà dans l’arbre (promo {alreadyThere.promo}). S’il manque un lien, utilise « Un lien manque ».
        </p>
      )}
      <div className="family-request__row">
        <div className="family-request__picker">
          <label htmlFor="student-request-promo">Année d’arrivée</label>
          <select id="student-request-promo" className="family-request__select" value={promo} onChange={edit(setPromo)}>
            <option value="">Choisir</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <div className="family-request__picker">
          <label htmlFor="student-request-code">Formation</label>
          <select id="student-request-code" className="family-request__select" value={code} onChange={edit(setCode)}>
            <option value="">Choisir</option>
            {CODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <StudentPicker
        id="student-request-parent"
        label="Parrain ou marraine (facultatif)"
        placeholder="Rechercher le parrain ou la marraine"
        students={students}
        value={parentId}
        onChange={(value) => {
          setFeedback(null);
          setParentId(value);
        }}
        onInteraction={() => setFeedback(null)}
      />
      <label className="family-request__message-label" htmlFor="student-request-message">
        Message <span>(facultatif)</span>
      </label>
      <textarea
        id="student-request-message"
        value={message}
        maxLength={1500}
        rows={3}
        placeholder="Ajoute un détail utile à la vérification…"
        onChange={edit(setMessage)}
      />
      {feedback && (
        <p className={`family-request__feedback family-request__feedback--${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
          {feedback.text}
        </p>
      )}
      <button
        className="btn family-request__submit"
        type="submit"
        disabled={busy || !firstName.trim() || !lastName.trim() || !promo || !code || Boolean(alreadyThere)}
      >
        {busy ? 'Envoi…' : 'Envoyer la demande'}
      </button>
    </form>
  );
}
