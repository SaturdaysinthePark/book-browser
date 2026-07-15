# analysis/ — structural community detection

Evaluation outputs from `tools/cluster-communities.mjs`. This is a **read-only analysis
pass**: it clusters books by mention-graph connectivity (Louvain modularity), independent
of genre. It does **not** touch the site, the DB, or `bookjumpr-data.js`.

## Regenerate

```bash
node tools/cluster-communities.mjs            # defaults: reads bookjumpr-data.js, writes here
node tools/cluster-communities.mjs --help     # all options
node tools/cluster-communities.mjs --resolution 1.5   # finer-grained communities
```

## Files (all regenerable — safe to delete)

| File | What it is |
| --- | --- |
| `community-report.md` | Human-readable report: summary, modularity, the two cluster *flavors* (neighborhood vs fan-out star), per-community table + detail. **Start here.** |
| `community-assignments.csv` | One row per book: `community_id, community_size, community_flavor, key, title, author, total_degree, out_mentions, in_mentions`. |
| `communities.json` | Full machine-readable structure (per-community hubs, star ratio, dominant source, members) for downstream tooling / the eventual visualization. |

## Key terms

- **Modularity Q** — how much denser edges are inside communities than expected by chance (0 = random, →1 = strongly separated).
- **Star ratio** — the single most-citing book's internal mentions ÷ the community's internal edges. Low ⇒ a genuine multi-source *neighborhood*; high (≥0.6) ⇒ a *fan-out star* (one book + its bibliography). See the report's "Two kinds of clusters" section.

The report's numbers were cross-checked by an independent Python re-implementation
(modularity reproduced exactly, invariants verified, agrees with label propagation).
