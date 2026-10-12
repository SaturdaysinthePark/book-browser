# BookJumpr film — the prompt

Our version of the shared motion-design prompt, adapted to BookJumpr: the logo's little book is the thread that links every scene, following one real "flow" through the site.

```
<inputs>
Ask me for: the opening book, the quote that makes the jump, the book it jumps to,
the two stats for the end card, and a track with a clear beat (or a tempo to cut to).
Defaults: Don Quixote → Madame Bovary via Harold Bloom's line "the female Quixote" ·
5,145 books · 7,764 mentions · 120 BPM.
</inputs>

<direction>
A 2D motion design film for BookJumpr, a site that maps the books mentioned inside other
books. 16:9 master, with a 9:16 cut. Warm paper canvas (#f7f5f0), near-black ink (#141414),
editorial serif titles (Instrument Serif), mono labels (IBM Plex Mono), flat genre-coloured
book covers. One accent: rust (#9c3d22). Blue (#2f5590) appears only where the site uses it,
for "mentioned by" lines.
The jumping book links every scene: the small rust book from the BookJumpr logo. It starts
on the logo's dotted arc, hops onto a cover, becomes the centre of a fan, underlines a
quote, leaps along a dotted arc to the next book, then joins the starfield and lands back on
the logo. A cursor makes the opening click feel real. Crisp, controlled movement with
subtle spring overshoot, dashed lines that draw on, no empty pauses.
Banned: stock footage, gradients, glows, particle bursts, 3D, arbitrary transitions, and
any movement that doesn't grow from something already on screen.
</direction>

<structure>
About 16 seconds (32 beats at 120 BPM), with a visual change on every major beat.
Open (beats 1–4): the BookJumpr logo. The small book rides its dotted arc and drops
  onto a wall of covers. A cursor glides in and clicks "Don Quixote".
Fan (5–10): the clicked cover shrinks into a black title pill. Blue dashed lines draw in
  from the left ("Mentioned by 75") and rust lines draw out to the right ("Mentions 41"),
  pills popping in one per beat-subdivision. The counters tick up as the lines land.
Quote (11–16): one blue line brightens. Its pill opens into a quote card from Harold
  Bloom's How to Read and Why: "…whose Madame Bovary is 'the female Quixote.'"
  "Madame Bovary" gets highlighted in rust, letter by letter.
Jump (17–22): the rust book lifts off the highlight and leaps along a dotted arc,
  overshoots and settles on "Madame Bovary". That becomes the new centre pill; the old fan
  folds away behind it. A trail of jumps (small covers joined by dotted arcs) builds along
  the top.
Zoom out (23–28): the pill folds into its genre dot. The camera pulls back. That dot is
  one star among 5,145, a field of genre-coloured points that fills past every edge, with
  rust and blue threads lighting from the current book.
End (29–32): the field contracts to the logo. "BookJumpr" sets in serif with
  "Follow the books inside the books." below and "5,145 books · 7,764 mentions" in mono.
  The small book settles on the arc exactly as in frame one, for a seamless loop.
</structure>

<build>
1. One HTML file, 1920×1080 (plus a 1080×1920 layout from the same timeline), 60 fps.
   Compute every visual from time inside seek(t): no CSS transitions, timers or state
   carried between frames.
2. Use one closed-form spring for every settle (cursor click, pill pops, the jump's landing,
   counters). The jump follows the logo's own arc, a quadratic from (4,30) to (58,23) via
   control point (30,−8), scaled.
3. Draw the dashed lines as path-length draw-ons, timed to the beat. Dashes keep moving in
   the direction of the mention: inward for blue, outward for rust.
4. Treat the cover, title pill, genre dot and star as states of one object. Carry its
   position and momentum through each change.
5. The starfield uses real positions from layouts-data.js (wrap layout) and real genre
   colours, so it's truthfully the site's map.
6. Align the click, the first line landing, the highlight, the jump's landing, the zoom-out
   and the title to beats. Render one still per beat to check timing before the full export.
</build>

<gotchas>
The jumping book must use the same arc and spring in every scene, or it stops reading as
one character. Use only the rust accent (blue only for in-lines). Time outgoing and
incoming text separately so letters never overlap. When the starfield fills the screen,
extend it past all four corners. Match the logo, the book's position and the paper
colour in the first and last frames so the loop doesn't stutter. Quotes must be verbatim
from the data.
</gotchas>

<start>
Ask me for the inputs, then show me the beat map and four stills (logo + click, fan,
quote + jump, end card) before building the full video.
</start>
```
