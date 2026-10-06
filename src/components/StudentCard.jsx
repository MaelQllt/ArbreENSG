import { useLayoutEffect, useRef, useState } from 'react';
import BrandDivider from './BrandDivider';
import { promoStyle } from '../theme';
import { describePromo, formatStudentAffiliations } from '../lib/promo';

function RelationList({ title, people, onSelect }) {
  return (
    <section className="card__section">
      <h3 className="card__section-title">{title}</h3>
      {people.length === 0 ? (
        <p className="card__empty">Aucun(e) renseigné(e)</p>
      ) : (
        <ul className="card__list">
          {people.map((p) => {
            // le trait et le fond au survol reprennent la couleur de promo de CETTE personne
            const { color, onColor } = promoStyle(p.promo);
            const { level, label } = describePromo(p.promo);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="card__link"
                  style={{ '--relation-color': color, '--relation-ink': onColor }}
                  onClick={() => onSelect(p.id)}
                >
                  <span>{p.name}</span>
                  <span className="card__link-promo">
                    {level >= 1 ? (
                      <>
                        {label} <BrandDivider /> {p.promo}
                      </>
                    ) : (
                      label
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function StudentCard({ student, parrains, fillots, lineage, onSelect, onClose }) {
  // Le panneau reste monté : on garde le dernier contenu pour qu'il soit lisible pendant qu'il se referme
  const last = useRef(null);
  const cardRef = useRef(null);
  const previousStudentId = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  if (student) last.current = { student, parrains, fillots, lineage };
  const data = last.current;
  const open = Boolean(student);
  const s = data?.student;
  const filiere = s ? s.filiere ?? s.parcours : null;
  const codeYear = s ? formatStudentAffiliations(s) : '';
  const familyCount = data ? data.parrains.length + data.fillots.length : 0;

  useLayoutEffect(() => {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile && student && previousStudentId.current !== student.id && cardRef.current) {
      cardRef.current.scrollTop = 0;
    }
    previousStudentId.current = student?.id ?? null;
  }, [student?.id]);

  const updateCardScrollHint = () => {
    const card = cardRef.current;
    const families = card?.querySelector('.card__families');
    if (!card || !families || !open || familyCount === 0) {
      setCanScrollDown(false);
      return;
    }
    const cardRect = card.getBoundingClientRect();
    const familiesRect = families.getBoundingClientRect();
    const next = card.scrollTop + card.clientHeight < card.scrollHeight - 1
      && familiesRect.bottom > cardRect.bottom - 12;
    setCanScrollDown((current) => current === next ? current : next);
  };

  useLayoutEffect(() => {
    const card = cardRef.current;
    const families = card?.querySelector('.card__families');
    if (!data || !card || !families || !open || familyCount === 0) {
      setCanScrollDown(false);
      return undefined;
    }

    updateCardScrollHint();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCardScrollHint);
    resizeObserver?.observe(card);
    Array.from(card.children).forEach((child) => resizeObserver?.observe(child));

    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateCardScrollHint);
    mutationObserver?.observe(families, { childList: true, subtree: true, characterData: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [open, s?.id, s?.name, codeYear, filiere, s?.bio, familyCount]);

  if (!data) return <aside className="card" aria-hidden="true" />;

  const promo = describePromo(s.promo);
  const { color, onColor } = promoStyle(s.promo);
  const nameLength = Array.from(s.name.trim()).length;
  const nameLengthClass = nameLength >= 32
    ? ' card__name--very-long'
    : nameLength >= 24 ? ' card__name--long' : '';

  return (
    <aside
      ref={cardRef}
      className={`card${open ? ' card--open' : ''}`}
      style={{ '--promo-color': color, '--promo-ink': onColor }}
      aria-label={`Fiche de ${s.name}`}
      aria-hidden={!open}
      onScroll={updateCardScrollHint}
    >
      <header className="card__header">
        <div className="card__promotion">
          <span className="card__promo">{promo.label}</span>
          <span className="card__cohort">{promo.detailOne}</span>
        </div>
        <button type="button" className="card__close" onClick={onClose} aria-label="Fermer la fiche">
          ×
        </button>
      </header>

      <h2 className={'card__name' + nameLengthClass}>{s.name}</h2>
      {(codeYear || filiere) && (
        <p className="card__meta">
          {codeYear && <strong>{codeYear}</strong>}
          {codeYear && filiere && <BrandDivider />}
          {filiere && <span>{filiere}</span>}
        </p>
      )}
      {s.bio && <p className="card__bio">{s.bio}</p>}

      <dl className="card__stats">
        <div>
          <dt>Famille ascendante</dt>
          <dd>{data.lineage.ancestors.size}</dd>
        </div>
        <div>
          <dt>Famille descendante</dt>
          <dd>{data.lineage.descendants.size}</dd>
        </div>
      </dl>

      <div className="card__families" aria-label="Familles de l’étudiant">
        <RelationList title="Parrains et marraines" people={data.parrains} onSelect={onSelect} />
        <RelationList title="Fillots et fillottes" people={data.fillots} onSelect={onSelect} />
      </div>
      {canScrollDown && <span className="card__scroll-hint" aria-hidden="true" />}
    </aside>
  );
}
