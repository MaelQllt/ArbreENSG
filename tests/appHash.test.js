import { describe, expect, it } from 'vitest';
import { buildAppHash, isAppHash, parseAppHash, studentSlug } from '../src/lib/appHash';

describe('adresses de l’arbre', () => {
  it('fabrique un identifiant lisible à partir du nom', () => {
    expect(studentSlug('Maël QUILLAT')).toBe('mael-quillat');
    expect(studentSlug("  Jean-Pierre d'Arc ")).toBe('jean-pierre-d-arc');
  });

  it('fait l’aller-retour pour une fiche et pour un lien', () => {
    expect(parseAppHash(buildAppHash('Maël QUILLAT'))).toEqual({ studentSlug: 'mael-quillat' });
    expect(parseAppHash(buildAppHash('Tom CADARIO', 'Jules HOUSEZ')))
      .toEqual({ studentSlug: 'tom-cadario', relationSlug: 'jules-housez' });
    expect(buildAppHash(null)).toBe('');
  });

  it('ne touche jamais aux autres adresses', () => {
    expect(isAppHash('')).toBe(true);
    expect(isAppHash('#etudiant/mael-quillat')).toBe(true);
    expect(isAppHash('#jeu')).toBe(false);
    expect(isAppHash('#access_token=abc&type=recovery')).toBe(false);
    expect(parseAppHash('#etudiant/')).toBeNull();
    expect(parseAppHash('#lien/a')).toBeNull();
  });
});
