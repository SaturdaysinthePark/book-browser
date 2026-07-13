// Title normalization shared by the dictionary builder and the detector, so a title
// written in prose ("The Trial") maps to the same key as its catalog entry. This is a
// *matching* key, NOT the site identity — that's `slug()`. We keep spaces (unlike slug)
// and preserve the leading article; the detector tries the article-less variant itself.

// Words that carry no title signal on their own. A candidate phrase that normalizes to
// exactly one of these is never treated as a book title (guards "It", "The Road" noise).
// Many are ALSO real one-word book titles in the curated tier (there's a novel literally
// called "Nothing"), but as a bare word in prose they're overwhelmingly the common word,
// so we require corroboration (a quote/byline/trigger via the multi-word or context path)
// rather than keeping them alone. Distinctive one-word titles (Macbeth, Beloved, Twilight,
// Sanshiro) are deliberately NOT here.
export const STOPWORD_TITLES = new Set([
  'the', 'a', 'an', 'it', 'i', 'he', 'she', 'they', 'we', 'you', 'him', 'her',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'so', 'life', 'time',
  'love', 'home', 'work', 'god', 'man', 'woman', 'day', 'night', 'yes', 'no',
  // calendar words — pure noise in any book
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  // very common words that are also one-word titles somewhere
  'after', 'nothing', 'finally', 'someone', 'remember', 'found', 'waiting', 'wanted',
  'caught', 'unless', 'truth', 'money', 'rules', 'police', 'alone', 'parts', 'naked',
  'lucky', 'leaving', 'cross', 'glass', 'harvest', 'silence', 'delicious', 'damaged',
  'rumors', 'boundaries', 'freedom', 'identity', 'revolution', 'darkness', 'light',
  'white', 'sister', 'someday', 'us', 'them', 'everything', 'nowhere', 'somewhere',
]);

// Lowercase, strip accents, drop any subtitle after a newline, and reduce to
// single-spaced alphanumerics. "The Brothers Karamazov: A Novel" -> "the brothers karamazov a novel".
export function normTitle(s) {
  return String(s == null ? '' : s)
    .split('\n')[0]                       // PG catalog titles pack a subtitle on line 2
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// The same title without a leading article, for the detector's second lookup pass.
// "the trial" -> "trial"; returns '' when nothing is left.
export function stripArticle(norm) {
  return String(norm).replace(/^(the|a|an)\s+/, '').trim();
}

// PG catalog authors look like "Dostoyevsky, Fyodor, 1821-1881; Garnett, Constance".
// Take the first author, drop life-year ranges, and flip "Last, First" -> "First Last".
export function formatAuthor(raw) {
  const first = String(raw == null ? '' : raw).split(';')[0].trim();
  if (!first) return '';
  const parts = first.split(',').map((p) => p.trim())
    .filter((p) => p && !/^\d{2,4}\??-?\d{0,4}\??$/.test(p)); // drop "1821-1881", "1900-", "800?-"
  if (parts.length >= 2) return `${parts[1]} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return parts[0] || '';
}

// Goodreads authors are already natural order, comma-separated: "J.K. Rowling, Mary GrandPré".
// The primary author is the part before the first comma.
export function firstAuthor(raw) {
  return String(raw == null ? '' : raw).split(',')[0].trim();
}

// Drop a trailing series/edition suffix that contains a "#n": "Dune (Dune Chronicles #1)"
// -> "Dune". Only strips parentheticals with a number sign, so real titles are left alone.
export function stripSeries(title) {
  return String(title == null ? '' : title).replace(/\s*\([^)]*#[\d.]+\)\s*$/, '').trim();
}
