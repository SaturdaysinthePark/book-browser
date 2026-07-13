// Book identity. MUST stay byte-for-byte identical to `P.slug` in app.js (~line 319),
// or tooling-generated ids will drift from the ones the live site computes.
// (A `doctor` parity check asserts this stays in sync.)
export function slug(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
