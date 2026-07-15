# BookJumpr — Structural Community Report

_Louvain community detection on the mention graph (nodes = books, edges = "A mentions B", treated as undirected). Communities are derived purely from graph connectivity — **no genre or subject labels are used**. Auto-generated from `bookjumpr-data.js`._

> **How to read this:** each community is a set of books that mention (or are mentioned by) each other more densely than the rest of the graph. Labels only name the community's highest-degree "hub" books so you can eyeball whether the grouping makes sense — they are not thematic names. Regenerate with `node tools/cluster-communities.mjs` (`--help` for options like `--resolution`).

## Summary

| Metric | Value |
| --- | --- |
| Books in graph (degree ≥ 1) | 1802 |
| Undirected mention edges | 2103 |
| Catalogued books with no mentions (excluded) | 92 |
| Connected components | 60 |
| Giant component | 1577 books (87.5%) |
| **Communities found** | **91** |
| **Modularity Q** | **0.8239** |
| Community size — min / median / max | 2 / 4 / 139 |
| Singleton communities | 0 |
| Internal edges (both ends same community) | 1815 (86.3%) |
| Cross-community edges | 288 (13.7%) |
| Resolution γ / restarts / seed | 1 / 10 / 1 |

### How clean is the separation?

86.3% of edges fall **inside** a community and 13.7% cross between communities. A modularity of **Q = 0.824** indicates **strong, well-separated** community structure.

### Two kinds of clusters — read this before trusting a group

Not every community means the same thing. This graph is a citation network: most books are **leaves** (mentioned once, mention nothing), attached to a handful of prolific "mentioner" books. So a community can form in two very different ways, and the **star ratio** (the single most-citing book's internal mentions ÷ the community's internal edges) tells them apart:

- **Neighborhood** (star ratio < 0.35) — several *independent* books mention an overlapping canon. These are genuine reading-neighborhoods: "these books belong together." *(e.g. the Victorian-novel and English-literary-canon clusters.)*
- **Mixed** (0.35–0.6) — a couple of co-anchoring sources plus shared references.
- **Fan-out star** (≥ 0.6) — **one** book plus everything *it* cites. Coheres by shared *source*, not mutual affinity; often still looks thematically tight because an author cites within their own subject, but it is really a single bibliography. *(e.g. a memoir + its entire reading list.)*

| Cluster type | Communities | Books covered |
| :--- | ---: | ---: |
| Neighborhood (multi-source) | 14 | 820 |
| Mixed | 12 | 417 |
| Fan-out star (single-source) | 65 | 565 |

**Takeaway:** most *communities* (65 of 91) are single-source fan-out stars, but the genuine multi-source neighborhoods are the **largest** ones, so they cover 68.6% of all books. For a legible visualization, the neighborhood/mixed clusters are the real regions; the fan-out stars are better thought of as "a source book and its bibliography" and could be collapsed onto their source node.

### Size distribution

- **91** of 91 communities have more than one book; **0** are singletons.
- Largest community: **139** books. Median: **4**.
- Best modularity across 10 restart(s): 0.8239 (worst 0.8203).
- The graph has 60 connected components (sizes: 1577, 17, 12, 12, 12, 9, 7, 7, 6, 6, 6, 5, …); every community lives inside exactly one component, so the 59 small components each contribute at least one small community regardless of Louvain.

```
community size    count
───────────────────────────
1              0  
2             25  ██████████████████████████████
3–5           24  █████████████████████████████
6–10           7  ████████
11–25          7  ████████
26–50         16  ███████████████████
51–100        10  ████████████
100+           2  ██
```

## Communities

Ranked by size. "Int %" = share of edge-endpoints that stay inside the community (higher = more self-contained). "Star" = star ratio (see above); **fan-out** = single-source bibliography, **nbhd** = genuine multi-source neighborhood. Hubs are the highest total-degree (in + out mentions) books.

| # | Size | Type | Star | Int % | Int/Cross | Label (hub books) |
| ---: | ---: | :--- | ---: | ---: | :--- | :--- |
| 0 | 139 | nbhd | 0.09 | 82.0% | 193 / 85 | anchored by Hamlet, Main Street, Romeo and Juliet |
| 1 | 106 | nbhd | 0.16 | 80.4% | 121 / 59 | anchored by The Autocrat of the Breakfast-Table, The Mill on the Floss, Rebecca of Sunnybrook Farm |
| 2 | 81 | nbhd | 0.26 | 79.3% | 86 / 45 | anchored by Robinson Crusoe, The Education of Henry Adams, The Voyage of the Beagle |
| 3 | 75 | fan-out | 0.60 | 83.8% | 75 / 29 | anchored by The Story of My Life, Westward Ho!, The Riddle of the Sands |
| 4 | 73 | nbhd | 0.18 | 87.1% | 74 / 22 | anchored by Eminent Victorians, Orthodoxy, Eight Cousins |
| 5 | 69 | nbhd | 0.16 | 86.0% | 74 / 24 | anchored by Man and Superman, Love and Mr Lewisham, Martin Eden |
| 6 | 60 | fan-out | 0.68 | 85.1% | 60 / 21 | anchored by Don Quixote, Micah Clarke, Twenty Years After |
| 7 | 53 | mixed | 0.38 | 98.1% | 52 / 2 | anchored by The Wealth of Nations, Democracy in America, A Vindication of the Rights of Woman |
| 8 | 53 | fan-out | 0.90 | 87.4% | 52 / 15 | anchored by The Art of Public Speaking, Mansfield Park, The Merry Wives of Windsor |
| 9 | 52 | nbhd | 0.25 | 88.7% | 55 / 14 | anchored by The Charterhouse of Parma, Hard Boiled Wonderland and the End of the World, The Idiot |
| 10 | 52 | fan-out | 1.00 | 97.1% | 51 / 3 | anchored by The Varieties of Religious Experience, Essays in Philosophy, Alterations of Personality |
| 11 | 51 | nbhd | 0.27 | 84.3% | 51 / 19 | anchored by The Song of the Lark, The Age of Reason, Tono-Bungay |
| 12 | 50 | mixed | 0.37 | 85.2% | 49 / 17 | anchored by Billy Budd, Jude the Obscure, Iliad |
| 13 | 50 | mixed | 0.39 | 88.3% | 49 / 13 | anchored by Representative Men, The Tragic Muse, Melmoth the Wanderer |
| 14 | 46 | fan-out | 0.82 | 94.7% | 45 / 5 | anchored by The Righteous Mind, The Iron Heel, On Liberty |
| 15 | 45 | nbhd | 0.28 | 84.4% | 46 / 17 | anchored by The Age of Innocence, Kipps, Sons and Lovers |
| 16 | 45 | mixed | 0.36 | 88.9% | 44 / 11 | anchored by Lost Illusions, Emile, The Prince |
| 17 | 45 | mixed | 0.36 | 88.9% | 44 / 11 | anchored by Bushido: The Soul of Japan, The History of Mr Polly, Little Men |
| 18 | 43 | nbhd | 0.26 | 85.1% | 43 / 15 | anchored by Elon Musk: Tesla, SpaceX, and the Quest for a Fantastic Future, Phantastes, A Portrait of the Artist as a Young Man |
| 19 | 42 | fan-out | 0.71 | 92.1% | 41 / 7 | anchored by The Canterbury Tales, The Hunchback of Notre-Dame, Romola |
| 20 | 42 | nbhd | 0.20 | 76.7% | 46 / 28 | anchored by Paradise Lost, Far from the Madding Crowd, Napoleon: A Life |
| 21 | 41 | mixed | 0.42 | 87.9% | 40 / 11 | anchored by The Autobiography of Benjamin Franklin, Growth of the Soil, Tristram Shandy |
| 22 | 40 | mixed | 0.59 | 88.6% | 39 / 10 | anchored by Moby-Dick, Novum Organum, The Advancement of Learning |
| 23 | 36 | nbhd | 0.17 | 81.8% | 36 / 16 | anchored by The Just City, The Philosopher Kings, The Republic |
| 24 | 34 | mixed | 0.41 | 77.3% | 34 / 20 | anchored by Kafka on the Shore, Faust, Macbeth |
| 25 | 32 | mixed | 0.45 | 92.5% | 31 / 5 | anchored by Northanger Abbey, Fathers and Sons, The Mysteries of Udolpho |
| 26 | 30 | nbhd | 0.28 | 78.4% | 29 / 16 | anchored by Ivanhoe, Les Misérables, The Last Chronicle of Barset |
| 27 | 29 | nbhd | 0.24 | 76.3% | 29 / 18 | anchored by A Thousand and One Nights, The Kreutzer Sonata, Special Topics in Calamity Physics |
| 28 | 24 | nbhd | 0.33 | 81.4% | 24 / 11 | anchored by Life on the Mississippi, Narrative of the Life of Frederick Douglass, Don Quixote |
| 29 | 19 | mixed | 0.56 | 90.0% | 18 / 4 | anchored by Scenes of Clerical Life, An Old-Fashioned Girl, Lady Audley's Secret |
| 30 | 17 | fan-out | 1.00 | 100.0% | 16 / 0 | anchored by The Valley of Decision, The Glories of Mary, Cento Novelle Antiche |
| 31 | 12 | fan-out | 1.00 | 100.0% | 11 / 0 | anchored by The Compleat Angler, A Private School of Defence, The Travels of Mendes Pinto |
| 32 | 12 | fan-out | 0.91 | 100.0% | 11 / 0 | anchored by The Curious Incident of the Dog in the Night-time, The Hound of the Baskervilles, DIANA: Her True Story |
| 33 | 12 | fan-out | 0.73 | 91.7% | 11 / 2 | anchored by Sister Carrie, Rip Van Winkle, The Haunted Hotel |
| 34 | 12 | fan-out | 1.00 | 100.0% | 11 / 0 | anchored by Pragmatism, City of God, De Amplitudine Regni Coelestis |
| 35 | 9 | fan-out | 1.00 | 100.0% | 8 / 0 | anchored by Americanah, Dreams of My Father, Things Fall Apart |
| 36 | 8 | fan-out | 1.00 | 93.3% | 7 / 1 | anchored by Dubliners, The Devout Communicant, The Arab's Farewell to his Steed |
| 37 | 7 | fan-out | 1.00 | 100.0% | 6 / 0 | anchored by Slaughterhouse-Five, Extraordinary Popular Delusions and the Madness of Crowds, The Destruction of Dresden |
| 38 | 7 | fan-out | 1.00 | 100.0% | 6 / 0 | anchored by Between the World and Me, Destruction of Black Civilization, The African Origin of Civilization |
| 39 | 6 | fan-out | 1.00 | 100.0% | 5 / 0 | anchored by The Old Wives' Tale, The Harvest of a Quiet Eye, The Experience of Life |
| 40 | 6 | fan-out | 1.00 | 100.0% | 5 / 0 | anchored by Burning Daylight, The Wheels of Chance, Caliban upon Setebos |
| 41 | 6 | fan-out | 1.00 | 100.0% | 5 / 0 | anchored by From the Earth to the Moon, The Plurality of Worlds, Journeys in the Moon |
| 42 | 5 | mixed | 0.50 | 100.0% | 4 / 0 | anchored by The Confessions, Crime and Punishment, Egyptian Nights |
| 43 | 5 | fan-out | 1.00 | 100.0% | 4 / 0 | anchored by Roughing It, The Mormon Prophet, Love Me Little, Love Me Long |
| 44 | 4 | fan-out | 1.00 | 100.0% | 3 / 0 | anchored by The Trojan Women, The Song of Roland, Encomium of Helen |
| 45 | 4 | fan-out | 1.00 | 100.0% | 3 / 0 | anchored by Notes from the Underground, The Shot, Manfred |
| 46 | 4 | fan-out | 1.00 | 100.0% | 3 / 0 | anchored by Erewhon, The Coming Race, Erewhon Revisited |
| 47 | 4 | fan-out | 1.00 | 100.0% | 3 / 0 | anchored by Carmilla, Philosophicae et Christianae Cogitationes de Vampiris, Magia Posthuma |
| 48 | 4 | fan-out | 1.00 | 100.0% | 3 / 0 | anchored by The Twelve Caesars, Bellum Punicum, Anticato |
| 49 | 3 | mixed | 0.50 | 100.0% | 2 / 0 | anchored by The Prisoner of Zenda, The Four Feathers, The Critic |
| 50 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Golden Ass, The Dialogue of Trismegistus, Meteorology |
| 51 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by A Study in Scarlet, The Murders in the Rue Morgue, Monsieur Lecoq |
| 52 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The White Company, Doon de Mayence, Garin de Montglane |
| 53 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Railway Children, The Child's Guide to Knowledge, The Man Who Was |
| 54 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Creativity, Inc., The Art of Animation, Buy Low, Sell High, Collect Early, and Pay Late: The Manager's Guide to Financial Survival |
| 55 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Reef, L'Ami Fritz, Le Vertige |
| 56 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Pollyanna, The Turn of the Tides, The Lost Heir |
| 57 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Sylvia's Lovers, A Treatise on Self-Knowledge, A Serious Call to a Devout and Holy Life |
| 58 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Praise of Folly, Gesta Romanorum, Gryllus |
| 59 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Une Vie, Méditations poétiques, Corinne |
| 60 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Bartleby, the Scrivener, The Freedom of the Will, The Doctrine of Philosophical Necessity Illustrated |
| 61 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Star Rover, Mahabharata, A Journal of the Shipwreck and Sufferings of Daniel Foss |
| 62 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Hunger, In Wonderland, The Spiritual Life of Modern America |
| 63 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Carmen, Bellum Hispaniense, Commentaries |
| 64 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by Captains Courageous, The Works of Josephus, Skipper Ireson's Ride |
| 65 | 3 | fan-out | 1.00 | 100.0% | 2 / 0 | anchored by The Outsiders, The Carpetbaggers, Gone with the Wind |
| 66 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Mein Kampf, The Book Thief |
| 67 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Oenone, Two on a Tower |
| 68 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Queen Elizabeth, The First Blast of the Trumpet Against the Monstruous Regiment of Women |
| 69 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Recueil des Miracles de l'Abbe Paris, An Enquiry Concerning Human Understanding |
| 70 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Compleat Fortune-Teller, Tess of the d'Urbervilles |
| 71 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Frogs, Andromeda |
| 72 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Discourses of Epictetus, The Enchiridion |
| 73 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Sign of the Four, The Martyrdom of Man |
| 74 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Ethics, Principles of Cartesian Philosophy |
| 75 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Riquet a la Houppe, The Secret Garden |
| 76 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Ethan Frome, Curfew Must Not Ring To-Night |
| 77 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Ruth, Lexicon totius Latinitatis (Facciolati's Latin Lexicon) |
| 78 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Deerslayer, A Country Doctor's Notebook |
| 79 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Innocence of Father Brown, The Invisible Man |
| 80 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The First Men in the Moon, The Works of William Shakespeare |
| 81 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Food of the Gods, The Mighty Atom |
| 82 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Island of Doctor Moreau, L'Homme qui Rit |
| 83 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Wealth Against Commonwealth, The Jungle |
| 84 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Daisy Miller, Paule Méré |
| 85 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Social Statics, Resurrection |
| 86 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Playboy of the Western World, The Shadow of the Glen |
| 87 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by The Subjection of Women, Delphine |
| 88 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Michael Strogoff, The Diverting History of John Gilpin |
| 89 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Wessex Tales, Domestic Medicine |
| 90 | 2 | fan-out | 1.00 | 100.0% | 1 / 0 | anchored by Green Mansions, Idle Days in Patagonia |

## Community detail (top 25)

### Community 0 — 139 books · nbhd (star 0.09)

**anchored by Hamlet, Main Street, Romeo and Juliet** · internal 82.0% · 193 internal / 85 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Hamlet | William Shakespeare | 26 | 0 | 26 |
| Main Street | Sinclair Lewis | 20 | 20 | 0 |
| Romeo and Juliet | William Shakespeare | 19 | 0 | 19 |
| Mrs Warren's Profession | George Bernard Shaw | 18 | 18 | 0 |
| The Antiquary | Walter Scott | 16 | 16 | 0 |

### Community 1 — 106 books · nbhd (star 0.16)

**anchored by The Autocrat of the Breakfast-Table, The Mill on the Floss, Rebecca of Sunnybrook Farm** · internal 80.4% · 121 internal / 59 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Autocrat of the Breakfast-Table | Oliver Wendell Holmes | 27 | 26 | 1 |
| The Mill on the Floss | George Eliot | 17 | 15 | 2 |
| Rebecca of Sunnybrook Farm | Kate Douglas Wiggin | 17 | 17 | 0 |
| Little Women | Louisa May Alcott | 14 | 13 | 1 |
| Cranford | Elizabeth Gaskell | 13 | 12 | 1 |

### Community 2 — 81 books · nbhd (star 0.26)

**anchored by Robinson Crusoe, The Education of Henry Adams, The Voyage of the Beagle** · internal 79.3% · 86 internal / 45 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Robinson Crusoe | Daniel Defoe | 33 | 0 | 33 |
| The Education of Henry Adams | Henry Adams | 27 | 27 | 0 |
| The Voyage of the Beagle | Charles Darwin | 17 | 16 | 1 |
| David Copperfield | Charles Dickens | 15 | 11 | 4 |
| The Valley of the Moon | Jack London | 8 | 8 | 0 |

### Community 3 — 75 books · fan-out (star 0.60)

**anchored by The Story of My Life, Westward Ho!, The Riddle of the Sands** · internal 83.8% · 75 internal / 29 cross edges

_Fan-out star: **The Story of My Life** alone accounts for 45 of 75 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Story of My Life | Helen Keller | 68 | 68 | 0 |
| Westward Ho! | Charles Kingsley | 20 | 20 | 0 |
| The Riddle of the Sands | Erskine Childers | 5 | 5 | 0 |
| Fables | Jean de La Fontaine | 3 | 0 | 3 |
| The Anatomy of Melancholy | Robert Burton | 3 | 0 | 3 |

### Community 4 — 73 books · nbhd (star 0.18)

**anchored by Eminent Victorians, Orthodoxy, Eight Cousins** · internal 87.1% · 74 internal / 22 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Eminent Victorians | Lytton Strachey | 15 | 15 | 0 |
| Orthodoxy | G. K. Chesterton | 13 | 13 | 0 |
| Eight Cousins | Louisa May Alcott | 13 | 13 | 0 |
| Spoon River Anthology | Edgar Lee Masters | 10 | 10 | 0 |
| Walden | Henry David Thoreau | 10 | 9 | 1 |

### Community 5 — 69 books · nbhd (star 0.16)

**anchored by Man and Superman, Love and Mr Lewisham, Martin Eden** · internal 86.0% · 74 internal / 24 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Man and Superman | George Bernard Shaw | 14 | 14 | 0 |
| Love and Mr Lewisham | H. G. Wells | 13 | 13 | 0 |
| Martin Eden | Jack London | 13 | 12 | 1 |
| Trilby | George du Maurier | 7 | 7 | 0 |
| John Barleycorn | Jack London | 7 | 7 | 0 |

### Community 6 — 60 books · fan-out (star 0.68)

**anchored by Don Quixote, Micah Clarke, Twenty Years After** · internal 85.1% · 60 internal / 21 cross edges

_Fan-out star: **Don Quixote** alone accounts for 41 of 60 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Don Quixote | Miguel de Cervantes | 65 | 41 | 24 |
| Micah Clarke | Arthur Conan Doyle | 8 | 8 | 0 |
| Twenty Years After | Alexandre Dumas | 5 | 5 | 0 |
| The Three Musketeers | Alexandre Dumas | 3 | 1 | 2 |
| Cyrano de Bergerac | Edmond Rostand | 2 | 2 | 0 |

### Community 7 — 53 books · mixed (star 0.38)

**anchored by The Wealth of Nations, Democracy in America, A Vindication of the Rights of Woman** · internal 98.1% · 52 internal / 2 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Wealth of Nations | Adam Smith | 21 | 20 | 1 |
| Democracy in America | Alexis de Tocqueville | 19 | 19 | 0 |
| A Vindication of the Rights of Woman | Mary Wollstonecraft | 9 | 9 | 0 |
| The Rights of Man | Thomas Paine | 4 | 4 | 0 |
| Reflections on the Revolution in France | Edmund Burke | 3 | 0 | 3 |

### Community 8 — 53 books · fan-out (star 0.90)

**anchored by The Art of Public Speaking, Mansfield Park, The Merry Wives of Windsor** · internal 87.4% · 52 internal / 15 cross edges

_Fan-out star: **The Art of Public Speaking** alone accounts for 47 of 52 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Art of Public Speaking | Dale Carnegie & J. Berg Esenwein | 60 | 60 | 0 |
| Mansfield Park | Jane Austen | 3 | 3 | 0 |
| The Merry Wives of Windsor | William Shakespeare | 3 | 0 | 3 |
| How Plants Grow | Asa Gray | 2 | 0 | 2 |
| Barnaby Rudge | Charles Dickens | 2 | 2 | 0 |

### Community 9 — 52 books · nbhd (star 0.25)

**anchored by The Charterhouse of Parma, Hard Boiled Wonderland and the End of the World, The Idiot** · internal 88.7% · 55 internal / 14 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Charterhouse of Parma | Stendhal | 18 | 17 | 1 |
| Hard Boiled Wonderland and the End of the World | Haruki Murakami | 14 | 14 | 0 |
| The Idiot | Fyodor Dostoevsky | 6 | 6 | 0 |
| Candide | Voltaire | 6 | 2 | 4 |
| The Brothers Karamazov | Fyodor Dostoevsky | 5 | 4 | 1 |

### Community 10 — 52 books · fan-out (star 1.00)

**anchored by The Varieties of Religious Experience, Essays in Philosophy, Alterations of Personality** · internal 97.1% · 51 internal / 3 cross edges

_Fan-out star: **The Varieties of Religious Experience** alone accounts for 51 of 51 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Varieties of Religious Experience | William James | 54 | 54 | 0 |
| Essays in Philosophy | Alexander Campbell Fraser | 1 | 0 | 1 |
| Alterations of Personality | Alfred Binet | 1 | 0 | 1 |
| Cherubinischer Wandersmann | Angelus Silesius | 1 | 0 | 1 |
| As a Matter of Course | Annie Payson Call | 1 | 0 | 1 |

### Community 11 — 51 books · nbhd (star 0.27)

**anchored by The Song of the Lark, The Age of Reason, Tono-Bungay** · internal 84.3% · 51 internal / 19 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Song of the Lark | Willa Cather | 18 | 18 | 0 |
| The Age of Reason | Thomas Paine | 16 | 15 | 1 |
| Tono-Bungay | H. G. Wells | 9 | 9 | 0 |
| The French Revolution: A History | Thomas Carlyle | 9 | 7 | 2 |
| Sentimental Education | Gustave Flaubert | 8 | 8 | 0 |

### Community 12 — 50 books · mixed (star 0.37)

**anchored by Billy Budd, Jude the Obscure, Iliad** · internal 85.2% · 49 internal / 17 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Billy Budd | Herman Melville | 24 | 24 | 0 |
| Jude the Obscure | Thomas Hardy | 10 | 9 | 1 |
| Iliad | Homer | 9 | 0 | 9 |
| Babbitt | Sinclair Lewis | 7 | 7 | 0 |
| Quo Vadis | Henryk Sienkiewicz | 6 | 6 | 0 |

### Community 13 — 50 books · mixed (star 0.39)

**anchored by Representative Men, The Tragic Muse, Melmoth the Wanderer** · internal 88.3% · 49 internal / 13 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Representative Men | Ralph Waldo Emerson | 24 | 24 | 0 |
| The Tragic Muse | Henry James | 12 | 12 | 0 |
| Melmoth the Wanderer | Charles Maturin | 9 | 9 | 0 |
| The History of Henry Esmond | William Makepeace Thackeray | 9 | 8 | 1 |
| Troilus and Criseyde | Geoffrey Chaucer | 4 | 0 | 4 |

### Community 14 — 46 books · fan-out (star 0.82)

**anchored by The Righteous Mind, The Iron Heel, On Liberty** · internal 94.7% · 45 internal / 5 cross edges

_Fan-out star: **The Righteous Mind** alone accounts for 37 of 45 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Righteous Mind | Jonathan Haidt | 42 | 42 | 0 |
| The Iron Heel | Jack London | 8 | 8 | 0 |
| On Liberty | John Stuart Mill | 2 | 0 | 2 |
| The Cynic's Word Book | Ambrose Bierce | 1 | 0 | 1 |
| Treason: Liberal Treachery from the Cold War to the War on Terrorism | Ann Coulter | 1 | 0 | 1 |

### Community 15 — 45 books · nbhd (star 0.28)

**anchored by The Age of Innocence, Kipps, Sons and Lovers** · internal 84.4% · 46 internal / 17 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Age of Innocence | Edith Wharton | 15 | 15 | 0 |
| Kipps | H. G. Wells | 12 | 12 | 0 |
| Sons and Lovers | D. H. Lawrence | 9 | 9 | 0 |
| The Octopus | Frank Norris | 8 | 8 | 0 |
| Howards End | E. M. Forster | 5 | 5 | 0 |

### Community 16 — 45 books · mixed (star 0.36)

**anchored by Lost Illusions, Emile, The Prince** · internal 88.9% · 44 internal / 11 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Lost Illusions | Honoré de Balzac | 20 | 20 | 0 |
| Emile | Jean-Jacques Rousseau | 15 | 15 | 0 |
| The Prince | Niccolò Machiavelli | 9 | 7 | 2 |
| L'Assommoir | Émile Zola | 4 | 4 | 0 |
| Evelina | Fanny Burney | 4 | 4 | 0 |

### Community 17 — 45 books · mixed (star 0.36)

**anchored by Bushido: The Soul of Japan, The History of Mr Polly, Little Men** · internal 88.9% · 44 internal / 11 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Bushido: The Soul of Japan | Inazo Nitobe | 18 | 18 | 0 |
| The History of Mr Polly | H. G. Wells | 13 | 13 | 0 |
| Little Men | Louisa May Alcott | 10 | 10 | 0 |
| The Arabian Nights | Anonymous | 8 | 0 | 8 |
| Arms and the Man | George Bernard Shaw | 5 | 5 | 0 |

### Community 18 — 43 books · nbhd (star 0.26)

**anchored by Elon Musk: Tesla, SpaceX, and the Quest for a Fantastic Future, Phantastes, A Portrait of the Artist as a Young Man** · internal 85.1% · 43 internal / 15 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Elon Musk: Tesla, SpaceX, and the Quest for a Fantastic Future | Ashlee Vance | 13 | 13 | 0 |
| Phantastes | George MacDonald | 11 | 11 | 0 |
| A Portrait of the Artist as a Young Man | James Joyce | 8 | 8 | 0 |
| The Count of Monte Cristo | Alexandre Dumas | 7 | 4 | 3 |
| The Innocents Abroad | Mark Twain | 7 | 7 | 0 |

### Community 19 — 42 books · fan-out (star 0.71)

**anchored by The Canterbury Tales, The Hunchback of Notre-Dame, Romola** · internal 92.1% · 41 internal / 7 cross edges

_Fan-out star: **The Canterbury Tales** alone accounts for 29 of 41 internal edges — this cluster is largely its bibliography._

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Canterbury Tales | Geoffrey Chaucer | 32 | 30 | 2 |
| The Hunchback of Notre-Dame | Victor Hugo | 8 | 7 | 1 |
| Romola | George Eliot | 6 | 6 | 0 |
| Inferno | Dante Alighieri | 5 | 0 | 5 |
| Miscellanea | Angelo Poliziano | 1 | 0 | 1 |

### Community 20 — 42 books · nbhd (star 0.20)

**anchored by Paradise Lost, Far from the Madding Crowd, Napoleon: A Life** · internal 76.7% · 46 internal / 28 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Paradise Lost | John Milton | 18 | 0 | 18 |
| Far from the Madding Crowd | Thomas Hardy | 11 | 11 | 0 |
| Napoleon: A Life | Andrew Roberts | 7 | 7 | 0 |
| The Vicar of Wakefield | Oliver Goldsmith | 7 | 0 | 7 |
| Vanity Fair | William Makepeace Thackeray | 6 | 5 | 1 |

### Community 21 — 41 books · mixed (star 0.42)

**anchored by The Autobiography of Benjamin Franklin, Growth of the Soil, Tristram Shandy** · internal 87.9% · 40 internal / 11 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Autobiography of Benjamin Franklin | Benjamin Franklin | 20 | 20 | 0 |
| Growth of the Soil | Knut Hamsun | 8 | 8 | 0 |
| Tristram Shandy | Laurence Sterne | 8 | 5 | 3 |
| Clarissa | Samuel Richardson | 7 | 5 | 2 |
| The Cloister and the Hearth | Charles Reade | 4 | 3 | 1 |

### Community 22 — 40 books · mixed (star 0.59)

**anchored by Moby-Dick, Novum Organum, The Advancement of Learning** · internal 88.6% · 39 internal / 10 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Moby-Dick | Herman Melville | 26 | 25 | 1 |
| Novum Organum | Francis Bacon | 7 | 7 | 0 |
| The Advancement of Learning | Francis Bacon | 5 | 0 | 5 |
| The Consolation of Philosophy | Boethius | 4 | 4 | 0 |
| Timaeus | Plato | 4 | 0 | 4 |

### Community 23 — 36 books · nbhd (star 0.17)

**anchored by The Just City, The Philosopher Kings, The Republic** · internal 81.8% · 36 internal / 16 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| The Just City | Jo Walton | 7 | 7 | 0 |
| The Philosopher Kings | Jo Walton | 7 | 7 | 0 |
| The Republic | Plato | 7 | 0 | 7 |
| North and South | Elizabeth Gaskell | 6 | 6 | 0 |
| Puck of Pook's Hill | Rudyard Kipling | 6 | 6 | 0 |

### Community 24 — 34 books · mixed (star 0.41)

**anchored by Kafka on the Shore, Faust, Macbeth** · internal 77.3% · 34 internal / 20 cross edges

| Hub book | Author | Total | Out | In |
| :--- | :--- | ---: | ---: | ---: |
| Kafka on the Shore | Haruki Murakami | 17 | 17 | 0 |
| Faust | Johann Wolfgang von Goethe | 10 | 0 | 10 |
| Macbeth | William Shakespeare | 10 | 0 | 10 |
| First Love | Ivan Turgenev | 8 | 8 | 0 |
| New Grub Street | George Gissing | 7 | 7 | 0 |

## Verification & confidence

The reported modularity and structure were cross-checked by an independent implementation:

- **Modularity reproduced exactly** — a separate Python re-computation of Q from the emitted partition matches this run to 6 decimals.
- **Structural invariants hold** — no community spans two connected components; internal + cross edge counts reconcile to the edge total; every book is assigned exactly once.
- **Above chance** — a random partition into the same number of communities scores Q ≈ 0, versus 0.82 here.
- **Independent algorithm agrees** — label propagation (a different method) recovers strongly overlapping communities (~87% of internal edges shared), so the structure is real, not a Louvain artifact.
- **Deterministic** — fixed seed ⇒ identical output across runs.

### Known limitations

- **Louvain finds a strong local optimum, not a proven global one.** Multiple seeded restarts are kept (best of 10); the spread here is tiny (0.8203–0.8239). Like all Louvain, a node is never ejected into its own singleton mid-sweep even if that would help — but an empirical check found **0** books where that would raise Q on this data, so it has no effect here. (Leiden would close this gap if it ever matters.)
- **Fan-out stars dominate by count.** 65 of 91 communities are one source book plus its citations; treat their "membership" as a bibliography, not a peer group (see *Two kinds of clusters*).
- **Graph is simple & undirected** for clustering: reciprocal/duplicate mentions collapse to one edge, and direction is ignored. In/out counts are retained only for hub ranking.
- **Identity is the data's.** Books are keyed exactly as the site keys them, so results map 1:1 to the live graph; any mis-merged/duplicated titles upstream carry through unchanged.

---

_Full per-book assignments in `community-assignments.csv`; machine-readable structure in `communities.json`. Regenerate: `node tools/cluster-communities.mjs` (`--help` for options)._
