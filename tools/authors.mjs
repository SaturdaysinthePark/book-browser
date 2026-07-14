// Author canonicalization. Same book cited under different author strings ("Sir Walter
// Scott" vs "Walter Scott", "Alfred, Lord Tennyson" vs "Alfred Tennyson") must resolve to
// ONE canonical name — both for clean display and so composite book identity
// (title + author) doesn't fragment a single book into duplicates. See tools/bookkey.mjs.

// A loose comparison key: lowercase, strip accents + punctuation, collapse spaces.
// Used to look an author up in ALIASES regardless of spelling/accents/honorifics.
export function authorKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Known variant -> canonical display name, keyed by authorKey(variant).
const ALIASES = {
  'alfred lord tennyson': 'Alfred Tennyson',
  'sir walter scott': 'Walter Scott',
  'jacques henri bernardin de saint pierre': 'Bernardin de Saint-Pierre',
  'omar khayyam': 'Omar Khayyám',
};

const HONORIFIC = /^(sir|lord|lady|dame|dr|mr|mrs|ms|miss|rev|reverend|fr|st|saint|prof|professor)\.?\s+/i;

// Do two author strings denote the same person? Same surname (last token) AND compatible
// given names — where one side's given-name initials are a prefix of the other's. So
// "Emerson" == "Ralph Waldo Emerson", "C. S. Baldwin" == "Charles Sears Baldwin",
// "George W Parker" == "George Wells Parker"; but "Dick Levin" != "Richard Levin" (D≠R) and
// "Emerson" != "Keith Richards". Prevents fragmentation from partial names/initials while
// keeping genuinely different authors apart.
export function sameAuthor(a, b) {
  const ka = authorKey(canonicalAuthor(a)), kb = authorKey(canonicalAuthor(b));
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = ka.split(' '), tb = kb.split(' ');
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;          // surnames must match
  const gi = (t) => t.slice(0, -1).map((w) => w[0]);                  // given-name initials
  const [s, l] = ta.length <= tb.length ? [gi(ta), gi(tb)] : [gi(tb), gi(ta)];
  return s.every((c, i) => c === l[i]);                              // shorter initials prefix longer
}

// Return the canonical display form of an author string ('' for blank/unknown).
export function canonicalAuthor(raw) {
  let s = String(raw == null ? '' : raw).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const alias = ALIASES[authorKey(s)];
  if (alias) return alias;
  // strip a leading honorific ("Sir Walter Scott" -> "Walter Scott") and re-check
  const stripped = s.replace(HONORIFIC, '').trim();
  if (stripped && stripped !== s) return ALIASES[authorKey(stripped)] || stripped;
  return s;
}
