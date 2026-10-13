// Easter egg ENSGdle : panneau révélant une photo et un mot.
// La photo est purement décorative, le message juste en dessous porte tout le sens,
// d'où le `alt` vide. Aucun bouton : on ferme avec Échap ou en touchant le fond.
export default function EasterEgg({ photoUrl, text, signature, onClose, modalRef }) {
  return (
    <div
      className="contact-info__overlay easter-egg-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={modalRef}
        className="easter-egg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="easter-egg-text"
        tabIndex={-1}
      >
        <img className="easter-egg__photo" src={photoUrl} alt="" />
        <div className="easter-egg__body">
          <p className="easter-egg__text" id="easter-egg-text">{text}</p>
          <p className="easter-egg__signature">{signature}</p>
        </div>
      </section>
    </div>
  );
}
