// Book identity = URL path = "<authorSlug>/<titleSlug>", e.g. "fyodor-dostoevsky/crime-and-
// punishment". Author-first, so (author, title) is inherently unique — no collision suffix.
// A book with no known author uses the "anonymous" author segment.
import { slug } from './slug.mjs';

export function titleSlug(title) { return slug(title); }
export function authorSlug(author) { return slug(author || '') || 'anonymous'; }

// The full key for a (title, canonical author) pair.
export function bookKey(title, canonicalAuthorName) {
  return `${authorSlug(canonicalAuthorName)}/${titleSlug(title)}`;
}
