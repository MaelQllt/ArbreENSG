import { useState } from 'react';

export default function PasswordInput({ id, ...inputProps }) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="password-input">
      <input id={id} {...inputProps} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-input__toggle"
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 3 21 21" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.2 0 9 5 9 7a9.7 9.7 0 0 1-3.1 4.8M6.2 6.2C3.9 7.7 2.2 10.1 2 12c0 2 3.8 7 10 7a10.5 10.5 0 0 0 4-.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}
