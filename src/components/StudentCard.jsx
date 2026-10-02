import { useRef } from 'react';
import BrandDivider from './BrandDivider';
import { promoStyle } from '../theme';
import { describePromo, formatCodeYear } from '../lib/promo';

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
  if (student) last.current = { student, parrains, fillots, lineage };
  const data = last.current;
  const open = Boolean(student);

  if (!data) return <aside className="card" aria-hidden="true" />;

  const s = data.student;
  const promo = describePromo(s.promo);
  const { color, onColor } = promoStyle(s.promo);
  const filiere = s.filiere ?? s.parcours;
  const codeYear = formatCodeYear(s.code, s.promo);

  return (
    <aside
      className={`card${open ? ' card--open' : ''}`}
      style={{ '--promo-color': color, '--promo-ink': onColor }}
      aria-label={`Fiche de ${s.name}`}
      aria-hidden={!open}
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

      <h2 className="card__name">{s.name}</h2>
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

      <RelationList title="Parrains et marraines" people={data.parrains} onSelect={onSelect} />
      <RelationList title="Fillots et fillottes" people={data.fillots} onSelect={onSelect} />
    </aside>
  );
}
