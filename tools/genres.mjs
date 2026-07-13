// The canonical genre list — MUST mirror `P.GEN3` in app.js (a `doctor` parity check
// asserts the names stay in sync). A book's stored `genre` is one of these `name`s.
export const GENRES = [
  { name: 'FICTION', mark: 'book', color: '#c4682e' },
  { name: 'POETRY & EPICS', mark: 'lyre', color: '#a34a9c' },
  { name: 'DRAMA & PLAYS', mark: 'masks', color: '#c33d2e' },
  { name: 'CRIME & MYSTERY', mark: 'magnifier', color: '#2e8156' },
  { name: 'SCI-FI', mark: 'saucer2', color: '#3d6fb0' },
  { name: 'FANTASY', mark: 'dragon2', color: '#7b5bb5' },
  { name: 'HORROR', mark: 'bat', color: '#4a3b52' },
  { name: 'ADVENTURE & TRAVEL', mark: 'sword', color: '#c04a70' },
  { name: 'HISTORY', mark: 'column', color: '#8a5a3a' },
  { name: 'BIOGRAPHY & MEMOIR', mark: 'clock', color: '#2f5590' },
  { name: 'PHILOSOPHY', mark: 'owl2', color: '#3f7d7d' },
  { name: 'PSYCHOLOGY', mark: 'butterfly', color: '#7ba03c' },
  { name: 'POLITICS & WORLD', mark: 'globe', color: '#6e6e6e' },
  { name: 'BUSINESS & ECONOMICS', mark: 'briefcase', color: '#8c6d24' },
  { name: 'ESSAYS & JOURNALISM', mark: 'pen', color: '#7d4a66' },
  { name: 'HUMOR & COMEDY', mark: 'jester', color: '#d9a62b' },
  { name: 'FOOD & COOKING', mark: 'pan', color: '#a04a2a' },
  { name: 'MISC', mark: 'diamond', color: '#141414' },
];

export function genreNames() { return GENRES.map((g) => g.name); }

// Resolve a user-supplied genre string to its canonical GEN3 name (case-insensitive),
// or null if it isn't a known genre. Empty/blank → null (means "unset").
export function canonicalGenre(name) {
  if (name == null) return null;
  const key = String(name).trim().toUpperCase();
  if (!key) return null;
  const hit = GENRES.find((g) => g.name === key);
  return hit ? hit.name : null;
}

export function isValidGenre(name) { return canonicalGenre(name) != null; }
