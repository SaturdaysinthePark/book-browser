/*
 * Data-generated write-ups for author and book pages (BJStories.author, BJStories.book).
 *
 * "<Author> and other books": a short, data-generated write-up for an author page — how many books mention the
 * author, which works most often, across how many years, who keeps coming back to them, what the author's own
 * books mention, and one quoted line.
 *
 * Shared by the server-rendered page (netlify/seo/render.js imports this file) and the app (app.js loads it on
 * author and book pages), so Google and visitors read the same text. It has no imports or exports: it sets
 * BJStories on the global object, which works both as a browser <script> and as an ES module import.
 *
 * Every sentence is built from counts, and each one is left out when the data doesn't support it. In running
 * text, counts of 20 or more are given as "more than N" with N rounded down (moreThan), so a sentence stays
 * true as mentions are added; the table of works gives exact counts.
 *
 * BJStories.author(input) → null (no links either way) or
 *   { heading, paras: [[part, …], …], quote: { text, from } | null, works: [{ id, n, ex }] }
 * where a part is a string, { book: id } (a book title, linked) or { author: slug, name } (an author, linked).
 *
 * input = {
 *   slug, name,                 the author
 *   works: [id, …],             their books on the site
 *   book(id) → { title, author, authorSlug, year, mentionedBy: [id, …], mentions: [id, …], weight }   (weight = in + out)
 *   note(fromId, toId) → the line where fromId mentions toId, or ''
 *   ranked: [{ slug, name, n }, …]   every author with their mention count (same rule as here), biggest first
 *   hasPage(slug) → whether that author has a page to link to
 * }
 *
 * "<Title> and other books": the same for a book page — how many books mention it (and its rank), over how many
 * years, the authors who return to it, what it mentions, the books they mention each other, the book most often
 * mentioned alongside it, and where it stands among its author's books.
 *
 * BJStories.book(input) → null (no links either way) or { heading, paras, quote } (parts as above), where
 * input = { id, book(id) (as above), note(from, to), rank(id) → 1-based rank by mentions (0 = unranked),
 *           authorWorks(slug) → [id, …], hasPage(slug) }
 */
(function (root) {
  'use strict';

  // The largest round number below n (5s under 100, 25s under 1,000, then 100s): "more than 75" for 78.
  function moreThan(n) {
    if (n < 20) return String(n);
    var step = n < 100 ? 5 : n < 1000 ? 25 : 100;
    return 'more than ' + (Math.floor((n - 1) / step) * step).toLocaleString('en-US');
  }
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function times(n) { return (WORDS[n] || String(n)) + ' times'; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  // "A, B and C" over parts arrays
  function joinParts(items) {
    var out = [];
    items.forEach(function (it, i) {
      if (i) out.push(i === items.length - 1 ? ' and ' : ', ');
      out.push.apply(out, it);
    });
    return out;
  }
  // a line from the book (not an editor's note like "Epigraph: …" or "Cited as …"), as in noteEl (app.js)
  function isQuote(n) {
    return !!n && !/\*$/.test(n) && /^["“‘'A-Z]/.test(n.trim()) && /[.!?…"”’')]$/.test(n.trim()) && !(/^\s*((chapter )?epigraph\b|(Referenced|Cited|Mentioned|Alluded|Discussed|Quoted (by|with|from))\b|—)/i.test(n) &&
      !/^\s*(referenced|cited|mentioned|alluded|discussed|quoted)/.test(n));
  }

  // How the text refers to the author after the first mention: the surname ("Shakespeare"), or the full name
  // for single names and joint authors ("Homer", "Dale Carnegie & J. Berg Esenwein").
  function shortName(name) {
    if (/&| and /.test(name)) return name;
    var t = name.replace(/[,()]/g, ' ').split(/\s+/).filter(Boolean);
    while (t.length > 1 && /^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(t[t.length - 1])) t.pop();
    return t[t.length - 1] || name;
  }

  function build(o) {
    var full = o.name, name = shortName(full), slug = o.slug;
    var heaviest = function (ids) { return ids.slice().sort(function (x, y) { return o.book(y).weight - o.book(x).weight || (x < y ? -1 : 1); })[0]; };
    var authorPart = function (a) { return a.slug && o.hasPage(a.slug) ? { author: a.slug, name: a.name } : a.name || 'an unknown author'; };
    var bookBy = function (id) { var b = o.book(id); return [{ book: id }].concat(b.author && b.author !== 'Anonymous' ? [' by ', authorPart({ slug: b.authorSlug, name: b.author })] : []); };
    var mine = o.works.filter(function (id) { return o.book(id); });
    var paras = [], p, quote = null, table = [];

    // ---- who mentions this author (leaving out the author's own books)
    var works = [], byBook = {}, books = 0, mentions = 0, authors = {};
    mine.forEach(function (id) {
      var by = o.book(id).mentionedBy.filter(function (m) { var mb = o.book(m); return mb && mb.authorSlug !== slug; });
      works.push({ id: id, title: o.book(id).title, n: by.length, by: by });
      by.forEach(function (m) {
        mentions++;
        if (!byBook[m]) {
          byBook[m] = []; books++;
          var mb = o.book(m), as = mb.authorSlug || mb.author;
          (authors[as] = authors[as] || { slug: mb.authorSlug, name: mb.author, books: 0 }).books++;
        }
        byBook[m].push(id);
      });
    });
    var mentioned = works.filter(function (w) { return w.n; })
      .sort(function (x, y) { return y.n - x.n || (x.title < y.title ? -1 : 1); });
    var nAuthors = Object.keys(authors).length;
    var rank = -1, tier = '';
    for (var i = 0; i < o.ranked.length; i++) if (o.ranked[i].slug === slug) { rank = i + 1; break; }

    if (books) {
      // 1. reach: rank, then how many books and authors, across how many works
      p = [];
      if (rank === 1 && mentions >= 5) p.push('No writer turns up inside other books on BookJumpr more often than ' + full + '. ');
      else if (rank > 0 && mentions >= 5) {
        tier = rank <= 10 ? 'ten' : rank <= 25 ? 'twenty-five' : rank <= 50 ? 'fifty' : rank <= 100 ? 'hundred' : '';
        if (tier) p.push(full + ' is one of the ' + tier + ' most-mentioned authors on BookJumpr. ');
      }
      var named = p.length > 0;   // the full name has been used: from here on, the short one
      if (books === 1) {
        var only = Object.keys(byBook)[0], ob = o.book(only);
        p.push((named ? name : full) + ' is mentioned in one book on BookJumpr: ');
        p.push.apply(p, bookBy(only));
        p.push(ob.year > 0 ? ' (' + ob.year + ')' : '');
        if (mine.length > 1) p.push(', which mentions ', { book: byBook[only][0] });
        p.push('.');
      } else {
        p.push(capital(moreThan(books)) + ' books ');
        if (nAuthors === 1) p.push('by ', authorPart(authors[Object.keys(authors)[0]]));
        else p.push('by ' + moreThan(nAuthors) + ' different authors');
        p.push(' mention ' + (named ? name : full));
        if (mine.length > 1 && mentioned.length > 1) {
          p.push(mentioned.length === mine.length
            ? ', across all ' + mine.length + ' of ' + name + '’s works on the site'
            : ', across ' + mentioned.length + ' of ' + name + '’s ' + mine.length + ' works on the site');
        }
        p.push('.');
        // the next author down, when the lead is wide
        if (rank === 1 && o.ranked[1] && o.ranked[1].n && mentions / o.ranked[1].n >= 2) {
          var nx = o.ranked[1];
          p.push(' That’s more than ' + times(Math.floor(mentions / nx.n)) + ' as many mentions as ', authorPart({ slug: nx.slug, name: nx.name }), ', the next most-mentioned author.');
        }
      }
      paras.push(p);

      // 2. which works, and across how many years
      p = [];
      var top = mentioned.filter(function (w) { return w.n >= 2; }).slice(0, 4);
      if (mentioned.length >= 2 && top.length) {
        p.push('The most-mentioned ' + plural(top.length, 'is', 'are') + ' ');
        p.push.apply(p, joinParts(top.map(function (w, i) {
          return [{ book: w.id }, ' (' + moreThan(w.n) + (i === 0 ? plural(w.n, ' book', ' books') : '') + ')'];
        })));
        p.push('. ');
      } else if (books > 1 && mentioned.length === 1 && mine.length > 1) {
        p.push('All of them mention ', { book: mentioned[0].id }, '. ');
      }
      var dated = Object.keys(byBook).filter(function (m) { return o.book(m).year > 0; })
        .sort(function (x, y) { return o.book(x).year - o.book(y).year || (x < y ? -1 : 1); });
      if (dated.length >= 2) {
        var e = dated[0], l = dated[dated.length - 1], span = o.book(l).year - o.book(e).year;
        if (span >= 30) {
          p.push('The mentions span ' + moreThan(span) + ' years, from ');
          p.push.apply(p, bookBy(e)); p.push(' (' + o.book(e).year + ') to ');
          p.push.apply(p, bookBy(l)); p.push(' (' + o.book(l).year + ').');
        }
      }
      if (p.length) paras.push(p);

      // 3. the writers who keep coming back, and the book that names the most works
      p = [];
      var loyal = Object.keys(authors).map(function (k) { return authors[k]; })
        .filter(function (a) { return a.books >= 3 && a.name && a.name !== 'Anonymous'; })
        .sort(function (x, y) { return y.books - x.books || (x.name < y.name ? -1 : 1); }).slice(0, 2);
      if (loyal.length) {
        p.push(loyal.length === 2 ? 'Some writers keep coming back: ' : 'One writer keeps coming back: ');
        p.push(authorPart(loyal[0]), ' mentions ' + name + ' in ' + moreThan(loyal[0].books) + ' books');
        if (loyal[1]) p.push(', ', authorPart(loyal[1]), ' in ' + moreThan(loyal[1].books));
        p.push('. ');
      }
      var most = Object.keys(byBook).sort(function (x, y) { return byBook[y].length - byBook[x].length || o.book(y).weight - o.book(x).weight; });
      if (most.length && byBook[most[0]].length >= 3) {
        var mb = most[0], cnt = byBook[mb].length, unique = !most[1] || byBook[most[1]].length < cnt;
        p.push.apply(p, bookBy(mb));
        p.push(' names ' + moreThan(cnt) + ' different works by ' + name + (unique ? ', more than any other book on the site.' : '.'));
      }
      if (p.length) paras.push(p);

      // one quoted line: from the most-connected book that quotes one of the most-mentioned works
      for (var w = 0; w < Math.min(3, mentioned.length) && !quote; w++) {
        var cands = mentioned[w].by.filter(function (m) { var n = o.note(m, mentioned[w].id); return isQuote(n) && n.length >= 40 && n.length <= 180; });
        if (cands.length) { var q = heaviest(cands); quote = { text: o.note(q, mentioned[w].id), from: q, about: mentioned[w].id }; }
      }

      // the table: the most-mentioned works, exact counts, each with a well-known book that mentions it
      var used = {};
      var rows = mentioned.filter(function (w) { return w.n >= 2; });
      if (rows.length >= 2) table = rows.slice(0, 10).map(function (w) {
        var fresh = w.by.filter(function (m) { return !used[m]; }), ex = heaviest(fresh.length ? fresh : w.by);
        used[ex] = 1;
        return { id: w.id, n: w.n, ex: ex };
      });
    }

    // ---- what this author's books mention (other authors' books)
    var outBooks = {}, nOut = 0, outAuthors = {}, outBy = {};
    mine.forEach(function (id) {
      (o.book(id).mentions || []).forEach(function (m) {
        var mb = o.book(m);
        if (!mb || mb.authorSlug === slug) return;
        if (!outBooks[m]) {
          outBooks[m] = 1; nOut++;
          if (mb.author && mb.author !== 'Anonymous') {
            var as = mb.authorSlug || mb.author;
            (outAuthors[as] = outAuthors[as] || { slug: mb.authorSlug, name: mb.author, books: 0 }).books++;
          }
        }
        (outBy[m] = outBy[m] || []).push(id);
      });
    });
    if (nOut) {
      p = [];
      var nOutAuthors = Object.keys(outAuthors).length;
      p.push(books ? 'In the other direction, ' : '', (books ? name : full) + (mine.length === 1 ? '’s ' : '’s books on the site '));
      if (mine.length === 1) p.push({ book: mine[0] }, ' ');
      p.push('mention' + (mine.length === 1 ? 's ' : ' '));
      if (nOut <= 3) {   // few enough to name
        p.push.apply(p, joinParts(Object.keys(outBooks).sort(function (x, y) { return o.book(y).weight - o.book(x).weight || (x < y ? -1 : 1); }).map(bookBy)));
      } else {
        p.push(moreThan(nOut) + ' books');
        if (nOutAuthors > 1) p.push(' by ' + moreThan(nOutAuthors) + ' different authors');
      }
      p.push('.');
      var favs = Object.keys(outAuthors).map(function (k) { return outAuthors[k]; }).filter(function (a) { return a.books >= 2; })
        .sort(function (x, y) { return y.books - x.books || (x.name < y.name ? -1 : 1); }).slice(0, 3);
      if (favs.length) {
        p.push(' The writers ' + name + ' turns to most ' + plural(favs.length, 'is', 'are') + ' ');
        p.push.apply(p, joinParts(favs.map(function (a) { return [authorPart(a), ' (' + moreThan(a.books) + plural(a.books, ' book', ' books') + ')']; })));
        p.push('.');
      }
      var again = Object.keys(outBy).filter(function (m) { return outBy[m].length >= 2; })
        .sort(function (x, y) { return outBy[y].length - outBy[x].length || o.book(y).weight - o.book(x).weight; });
      if (again.length && mine.length > 1) {
        p.push(' ');
        p.push.apply(p, bookBy(again[0]));
        p.push(' comes up in ' + moreThan(outBy[again[0]].length) + ' of ' + name + '’s books.');
      }
      paras.push(p);
      // no quote yet (nobody quotes this author): one of this author's own lines about another book
      if (!quote) {
        var lines = [];
        Object.keys(outBy).forEach(function (m) { outBy[m].forEach(function (src) { var n = o.note(src, m); if (isQuote(n) && n.length >= 40 && n.length <= 180) lines.push([src, m]); }); });
        lines.sort(function (x, y) { return o.book(y[1]).weight - o.book(x[1]).weight || (x[1] < y[1] ? -1 : 1); });
        if (lines.length) quote = { text: o.note(lines[0][0], lines[0][1]), from: lines[0][0], about: lines[0][1] };
      }
    }

    if (!paras.length) return null;
    return { heading: name + ' and other books', paras: paras, quote: quote, works: table };
  }

  function buildBook(o) {
    var id = o.id, me = o.book(id);
    if (!me) return null;
    var mySlug = me.authorSlug, title = { book: id };
    var heaviest = function (ids) { return ids.slice().sort(function (x, y) { return o.book(y).weight - o.book(x).weight || (x < y ? -1 : 1); })[0]; };
    var authorPart = function (a) { return a.slug && o.hasPage(a.slug) ? { author: a.slug, name: a.name } : a.name || 'an unknown author'; };
    var named = function (b) { return b.author && b.author !== 'Anonymous'; };
    var bookBy = function (k) { var b = o.book(k); return [{ book: k }].concat(named(b) ? [' by ', authorPart({ slug: b.authorSlug, name: b.author })] : []); };
    var by = me.mentionedBy.filter(function (m) { return o.book(m) && m !== id; });
    var out = (me.mentions || []).filter(function (m) { return o.book(m) && m !== id; });
    if (!by.length && !out.length) return null;
    var paras = [], p = [], quote = null;
    var authorsOf = function (ids) {
      var a = {};
      ids.forEach(function (k) { var b = o.book(k); if (!named(b)) return; var key = b.authorSlug || b.author; (a[key] = a[key] || { slug: b.authorSlug, name: b.author, books: 0 }).books++; });
      return Object.keys(a).map(function (k) { return a[k]; }).sort(function (x, y) { return y.books - x.books || (x.name < y.name ? -1 : 1); });
    };

    // 1. who mentions it: rank, how many books and authors, over how many years, who returns to it
    if (by.length) {
      var rank = o.rank(id);
      if (rank === 1) p.push(title, ' is the most-mentioned book on BookJumpr. ');
      else if (rank > 0 && by.length >= 3) {
        var tier = rank <= 10 ? 'ten' : rank <= 25 ? 'twenty-five' : rank <= 50 ? 'fifty' : rank <= 100 ? 'hundred' : '';
        if (tier) p.push(title, ' is one of the ' + tier + ' most-mentioned books on BookJumpr. ');
      }
      var lead = p.length ? 'It' : null;
      if (by.length === 1) {
        var only = by[0], ob = o.book(only);
        p.push(lead ? 'It is mentioned in one book: ' : '', lead ? '' : title, lead ? '' : ' is mentioned in one book on BookJumpr: ');
        p.push.apply(p, bookBy(only));
        p.push(ob.year > 0 ? ' (' + ob.year + ').' : '.');
      } else {
        var auth = authorsOf(by);
        p.push(capital(moreThan(by.length)) + ' books');
        if (auth.length > 1) p.push(' by ' + moreThan(auth.length) + ' different authors');
        else if (auth.length === 1) p.push(', all by ', authorPart(auth[0]), ',');
        p.push(' mention ', lead ? 'it' : title, '.');
        var dated = by.filter(function (m) { return o.book(m).year > 0; }).sort(function (x, y) { return o.book(x).year - o.book(y).year || (x < y ? -1 : 1); });
        if (dated.length >= 2) {
          var e = dated[0], l = dated[dated.length - 1], span = o.book(l).year - o.book(e).year;
          if (span >= 30) {
            p.push(' They span ' + moreThan(span) + ' years, from ');
            p.push.apply(p, bookBy(e)); p.push(' (' + o.book(e).year + ') to ');
            p.push.apply(p, bookBy(l)); p.push(' (' + o.book(l).year + ').');
          }
        }
        var loyal = auth.filter(function (a) { return a.books >= 2 && a.slug !== mySlug; }).slice(0, 2);
        if (loyal.length) {
          p.push(' ', authorPart(loyal[0]), ' mentions it in ' + moreThan(loyal[0].books) + ' books');
          if (loyal[1]) p.push(', ', authorPart(loyal[1]), ' in ' + moreThan(loyal[1].books));
          p.push('.');
        }
      }
      paras.push(p);
    }

    // 2. what it mentions, the books it trades mentions with, and the one it mentions that the rest of the site mentions most
    if (out.length) {
      p = [];
      var oauth = authorsOf(out);
      p.push(by.length ? 'In turn, ' : '', by.length ? 'it' : title, ' mentions ');
      if (out.length <= 3) p.push.apply(p, joinParts(out.slice().sort(function (x, y) { return o.book(y).weight - o.book(x).weight || (x < y ? -1 : 1); }).map(bookBy)));
      else {
        p.push(moreThan(out.length) + ' books');
        if (oauth.length > 1) p.push(' by ' + moreThan(oauth.length) + ' different authors');
      }
      p.push('.');
      var favs = oauth.filter(function (a) { return a.books >= 2 && a.slug !== mySlug; }).slice(0, 2);
      if (out.length > 3 && favs.length) {
        p.push(' The writer' + (favs.length > 1 ? 's' : '') + ' it returns to most ' + (favs.length > 1 ? 'are ' : 'is '));
        p.push.apply(p, joinParts(favs.map(function (a) { return [authorPart(a), ' (' + moreThan(a.books) + ' books)']; })));
        p.push('.');
      }
      var famous = out.slice().sort(function (x, y) { return o.book(y).mentionedBy.length - o.book(x).mentionedBy.length || (x < y ? -1 : 1); })[0];
      if (out.length > 3 && o.book(famous).mentionedBy.length >= 10) {
        p.push(' Of these, ');
        p.push.apply(p, bookBy(famous));
        p.push(' is the most mentioned across the site (' + moreThan(o.book(famous).mentionedBy.length) + ' books).');
      }
      var mutual = out.filter(function (m) { return by.indexOf(m) !== -1; });
      if (mutual.length) {
        p.push(' ', title, ' and ');
        p.push.apply(p, joinParts(mutual.slice(0, 3).map(bookBy)));
        p.push(' mention each other.');
      }
      paras.push(p);
    }

    // 3. the book most often mentioned alongside it, and where it stands among its author's books
    p = [];
    var co = {};
    by.forEach(function (m) { (o.book(m).mentions || []).forEach(function (x) { if (x !== id && o.book(x) && o.book(x).authorSlug !== mySlug) co[x] = (co[x] || 0) + 1; }); });
    var pal = Object.keys(co).sort(function (x, y) { return co[y] - co[x] || o.book(y).weight - o.book(x).weight || (x < y ? -1 : 1); })[0];
    if (pal && co[pal] >= 2) {
      p.push('The book most often mentioned alongside it is ');
      p.push.apply(p, bookBy(pal));
      p.push(': ' + moreThan(co[pal]) + ' of the books that mention ', title, ' mention it too. ');
    }
    if (named(me) && o.hasPage(mySlug)) {
      var mine = o.authorWorks(mySlug).filter(function (k) { return o.book(k); });
      if (mine.length >= 2) {
        // mentions from other authors' books only, so an author citing their own work doesn't count
        var ext = function (k) { return o.book(k).mentionedBy.filter(function (m) { return o.book(m) && o.book(m).authorSlug !== mySlug; }).length; };
        var top = mine.slice().sort(function (x, y) { return ext(y) - ext(x) || (x < y ? -1 : 1); });
        var au = authorPart({ slug: mySlug, name: me.author }), sn = shortName(me.author);
        if (top[0] === id && ext(id) && (!top[1] || ext(top[1]) < ext(id))) p.push('It is the most-mentioned of ', au, '’s ' + mine.length + ' books on the site.');
        else if (ext(top[0]) && top[0] !== id) { p.push('It is one of ' + mine.length + ' books by ', au, ' on the site; ' + sn + '’s most-mentioned is ', { book: top[0] }, '.'); }
        else p.push('It is one of ' + mine.length + ' books by ', au, ' on the site.');
      }
    }
    if (p.length) paras.push(p);

    // one quoted line: the best-known book that mentions it, else a line of its own about another book
    var lines = by.filter(function (m) { var n = o.note(m, id); return isQuote(n) && n.length >= 40 && n.length <= 200; });
    if (lines.length) { var q = heaviest(lines); quote = { text: o.note(q, id), from: q, about: id }; }
    else {
      var own = out.filter(function (m) { var n = o.note(id, m); return isQuote(n) && n.length >= 40 && n.length <= 200; });
      if (own.length) { var r = heaviest(own); quote = { text: o.note(id, r), from: id, about: r }; }
    }
    return { heading: me.title + ' and other books', paras: paras, quote: quote };
  }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  root.BJStories = { author: build, book: buildBook, moreThan: moreThan };
})(typeof globalThis !== 'undefined' ? globalThis : window);
