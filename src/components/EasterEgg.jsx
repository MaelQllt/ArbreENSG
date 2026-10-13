// Easter egg ENSGdle : panneau révélant une photo et un mot.
// La photo est purement décorative, le message juste en dessous porte tout le sens,
// d'où le `alt` vide. Aucun bouton : on ferme avec Échap ou en touchant le fond.

// Sur mobile la phrase est coupée après la virgule. Le retour à la ligne est un
// <br> masqué sur grand écran, et le texte reste parfaitement lisible même s'il
// change et ne contient plus de virgule.
function renderMessage(text) {
  const separator = text.indexOf(',');
  if (separator < 0) return text;
  return (
    <>
      {text.slice(0, separator + 1)}
      <br className="easter-egg__break" />
      {text.slice(separator + 1).trimStart()}
    </>
  );
}

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
          <p className="easter-egg__text" id="easter-egg-text">{renderMessage(text)}</p>
          <p className="easter-egg__signature">{signature}</p>
        </div>
      </section>
    </div>
  );
}
