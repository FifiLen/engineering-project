/** Daty na stronie w strefie Europe/Warsaw (arc42 §8.5): „18 listopada 2026” i „18.11.2026”. */
const long = new Intl.DateTimeFormat('pl', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Warsaw',
});
const short = new Intl.DateTimeFormat('pl', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: 'Europe/Warsaw',
});

export const formatLongDate = (iso: string) => long.format(new Date(iso));
export const formatShortDate = (iso: string) => short.format(new Date(iso));
