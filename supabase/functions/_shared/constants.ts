// Konstanter, som både backend og frontend bruger. Ingen afhængigheder, så
// frontenden kan importere dem uden at trække Zod med ind i bundtet.

export const FILM_STYLES = [
  'mockumentary',
  'dokumentar',
  'reklame',
  'komedie',
  'drama',
  'animation',
  'musikvideo',
  'andet',
] as const;

export const MIN_FILM_SECONDS = 10;
export const MAX_FILM_SECONDS = 600;
