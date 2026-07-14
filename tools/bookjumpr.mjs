#!/usr/bin/env -S node --experimental-sqlite --no-warnings
// BookJumpr CLI — the single entrypoint for the data pipeline.
// Run via the npm scripts (which add --experimental-sqlite), e.g. `npm run bj -- <cmd>`.
import { open, counts, DB_PATH } from './db.mjs';
import { slug } from './slug.mjs';
import { seed } from './seed.mjs';
import { writeBuild } from './build.mjs';
import {
  upsertBook, upsertMention, importJsonFile, exportCsv, importCsv,
  renameBook, removeMention, removeBook, setGenre,
} from './importer.mjs';
import { doctor, printReport } from './doctor.mjs';
import { GENRES } from './genres.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true;
      else { a[key] = next; i++; }
    } else a._.push(tok);
  }
  return a;
}

const HELP = `BookJumpr data pipeline

Usage: npm run bj -- <command> [options]

  init                         Create the database + schema (idempotent)
  seed [--reset] [--verify]    Load the existing bookjumpr-data.js into the DB
  build [--check] [--force]    Regenerate bookjumpr-data.js from the DB
  stats                        Print books / mentions / sources counts
  slug "<title>"               Print the site slug for a title
  list [books|mentions]        List rows (default: books)
  search <query>               Find books by title or author

  add-book --title T [--author A] [--year Y] [--synopsis S] [--genre G]
  add-mention --source S --mentioned M [--author A] [--source-author SA] [--note N]
  set-genre --title T --genre G [--author A]   Assign a genre (--genre "" clears → MISC)
  genres                       List the assignable genres
  import <file.json>           Import a JSON batch (books[] + mentions[] + genres[])
  export-csv                   Write data/books.csv + data/mentions.csv
  import-csv [--replace]       Load data/*.csv into the DB
  rename --from OLD --to NEW    Rename a book (cascades its key)
  remove-mention --source S --mentioned M [--author A] [--source-author SA]
  remove-book --title T [--cascade] [--author A]
  # keys are author-first (slug(author)/slug(title)); --author disambiguates a shared title
  doctor [--fix]               Validate the dataset
`;

function withDb(fn) {
  const db = open();
  try { return fn(db); } finally { db.close(); }
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

try {
  await run(cmd, args);
} catch (e) {
  console.error('✗ ' + (e && e.message ? e.message : e));
  process.exit(1);
}

async function run(cmd, args) {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;

    case 'init':
      withDb(() => {});
      console.log('✓ Database ready at ' + DB_PATH);
      return;

    case 'slug':
      if (!args._[0]) throw new Error('usage: slug "<title>"');
      console.log(slug(args._.join(' ')));
      return;

    case 'stats':
      withDb((db) => {
        const c = counts(db);
        console.log(`books in the network : ${c.books}`);
        console.log(`mentions logged      : ${c.mentions}`);
        console.log(`books indexed so far : ${c.sources}`);
        console.log(`books with metadata  : ${c.meta}`);
      });
      return;

    case 'seed':
      withDb((db) => {
        const r = seed(db, { reset: !!args.reset, verify: !!args.verify });
        console.log(`✓ seeded: books=${r.books}, meta=${r.meta}, mentions=${r.mentions}, sources=${r.sources}, dupes=${r.dupes}`);
        if (r.dupes) console.log('  collapsed duplicate links:', JSON.stringify(r.dupeExamples));
        if (args.verify) {
          if (r.identical) console.log('✓ verify: rebuilt bookjumpr-data.js is BYTE-IDENTICAL to the current file');
          else {
            console.log(`✗ verify: DIFFERS at byte ${r.firstDiffAt}`);
            console.log('  original:', r.diffOriginal);
            console.log('  rebuilt :', r.diffRebuilt);
            process.exitCode = 2;
          }
        }
      });
      return;

    case 'build':
      withDb((db) => {
        // Gate on validation (errors block; --force overrides). Skipped for --check dry-runs.
        if (!args.check) {
          const rep = doctor(db);
          if (rep.errors.length && !args.force) {
            console.log('✗ build blocked — fix these errors (or pass --force):');
            printReport(rep);
            process.exitCode = 2;
            return;
          }
          if (rep.errors.length) { console.log('⚠ building despite errors (--force):'); printReport(rep); }
        }
        const r = writeBuild(db, { check: !!args.check });
        if (args.check) {
          console.log(r.identical ? '✓ build --check: up to date (no change)' : '! build --check: bookjumpr-data.js WOULD change');
          if (!r.identical) process.exitCode = 1;
        } else {
          exportCsv(db); // keep the CSV backup in lockstep with each build
          console.log(`✓ wrote bookjumpr-data.js (${r.bytes} bytes)${r.changed ? '' : ' — no change'} + refreshed data/*.csv`);
        }
      });
      return;

    case 'list':
      withDb((db) => {
        const what = args._[0] || 'books';
        if (what === 'mentions') {
          const rows = db.prepare(`SELECT b1.title AS s, b2.title AS t, m.mentioned_author AS a
            FROM mentions m JOIN books b1 ON b1.slug=m.source_slug JOIN books b2 ON b2.slug=m.mentioned_slug
            ORDER BY m.id`).all();
          for (const r of rows) console.log(`${r.s}  →  ${r.t}${r.a ? '  (' + r.a + ')' : ''}`);
          console.log(`\n${rows.length} mentions`);
        } else {
          const rows = db.prepare(`SELECT slug, title, author, year, has_meta,
            (SELECT COUNT(*) FROM mentions WHERE source_slug=books.slug) AS out,
            (SELECT COUNT(*) FROM mentions WHERE mentioned_slug=books.slug) AS inn
            FROM books ORDER BY title`).all();
          for (const r of rows) console.log(`${r.has_meta ? '●' : '○'} ${r.title}${r.author ? ' — ' + r.author : ''}  [→${r.out} ←${r.inn}]  (${r.slug})`);
          console.log(`\n${rows.length} books  (● has metadata, ○ identity-only)`);
        }
      });
      return;

    case 'search':
      withDb((db) => {
        const q = '%' + args._.join(' ').toLowerCase() + '%';
        const rows = db.prepare(`SELECT title, author, has_meta FROM books
          WHERE lower(title) LIKE ? OR lower(COALESCE(author,'')) LIKE ? ORDER BY title`).all(q, q);
        for (const r of rows) console.log(`${r.has_meta ? '●' : '○'} ${r.title}${r.author ? ' — ' + r.author : ''}`);
        console.log(`\n${rows.length} match(es)`);
      });
      return;

    case 'add-book':
      withDb((db) => {
        const r = upsertBook(db, { title: args.title, author: args.author, year: args.year, synopsis: args.synopsis, genre: args.genre });
        console.log(`✓ ${r.createdRow ? 'added' : r.wasMeta ? 'updated' : 'added metadata to'} book: ${args.title}  (${r.slug})`);
        console.log('  run `build` to regenerate the site.');
      });
      return;

    case 'set-genre':
      if (!args.title || args.genre === undefined) throw new Error('usage: set-genre --title T --genre "GENRE" (use --genre "" to clear)');
      withDb((db) => {
        const g = args.genre === true ? '' : args.genre;
        const r = setGenre(db, args.title, g, args.author);
        console.log(r.genre ? `✓ ${args.title} → genre "${r.genre}"` : `✓ cleared genre on ${args.title} (→ MISC)`);
        console.log('  run `build` to regenerate the site.');
      });
      return;

    case 'genres':
      console.log('Assignable genres (name — cover color):');
      for (const g of GENRES) console.log(`  ${g.name}${' '.repeat(Math.max(1, 22 - g.name.length))}${g.color}`);
      return;

    case 'add-mention':
      withDb((db) => {
        const r = upsertMention(db, { source: args.source, mentioned: args.mentioned, author: args.author, sourceAuthor: args['source-author'], note: args.note, update: !!args.force });
        console.log(r.added ? `✓ added mention: ${args.source} → ${args.mentioned}`
          : r.updated ? `✓ updated existing mention: ${args.source} → ${args.mentioned}`
          : `• mention already exists (skipped): ${args.source} → ${args.mentioned}  (use --force to update author/note)`);
        console.log('  run `build` to regenerate the site.');
      });
      return;

    case 'import': {
      const file = args._[0];
      if (!file) throw new Error('usage: import <file.json>');
      withDb((db) => {
        const r = importJsonFile(db, file);
        console.log(`✓ imported ${file}`);
        console.log(`  books: +${r.booksCreated} new, ${r.booksMetaSet} with metadata`);
        console.log(`  mentions: +${r.mentionsAdded} added, ${r.mentionsUpdated} updated, ${r.mentionsDup} already present`);
        if (r.genresSet) console.log(`  genres: ${r.genresSet} assigned`);
        console.log('  run `build` to regenerate the site.');
      });
      return;
    }

    case 'export-csv':
      withDb((db) => {
        const r = exportCsv(db);
        console.log(`✓ wrote data/books.csv (${r.books}) and data/mentions.csv (${r.mentions})`);
      });
      return;

    case 'import-csv':
      withDb((db) => {
        const r = importCsv(db, { replace: !!args.replace });
        console.log(`✓ imported CSVs${args.replace ? ' (replace mode)' : ''}: books ${r.booksMetaSet}, mentions +${r.mentionsAdded} (${r.mentionsDup} already present)`);
        console.log('  run `build` to regenerate the site.');
      });
      return;

    case 'rename':
      if (!args.from || !args.to) throw new Error('usage: rename --from "Old Title" --to "New Title"');
      withDb((db) => {
        const r = renameBook(db, args.from, args.to);
        console.log(`✓ renamed to "${args.to}"`);
        if (r.slugChanged) console.log(`  ⚠ key changed ${r.from} → ${r.slug} (its #/<author>/<title> URL changes).`);
      });
      return;

    case 'remove-mention':
      if (!args.source || !args.mentioned) throw new Error('usage: remove-mention --source S --mentioned M');
      withDb((db) => {
        const r = removeMention(db, args.source, args.mentioned, { sourceAuthor: args['source-author'], mentionedAuthor: args.author });
        console.log(r.removed ? `✓ removed mention: ${args.source} → ${args.mentioned}` : '• no such mention');
      });
      return;

    case 'remove-book':
      if (!args.title) throw new Error('usage: remove-book --title T [--cascade]');
      withDb((db) => {
        const r = removeBook(db, args.title, { cascade: !!args.cascade, author: args.author });
        console.log(r.removed ? `✓ removed book: ${args.title}${r.mentionsRemoved ? ` (and ${r.mentionsRemoved} mention(s))` : ''}` : '• no such book');
      });
      return;

    case 'doctor':
      withDb((db) => {
        const rep = doctor(db, { fix: !!args.fix });
        const code = printReport(rep);
        if (code) process.exitCode = code;
      });
      return;

    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}
