# BookJumpr film — the prompt

Our version of the shared motion-design prompt, adapted to BookJumpr: playful, a real path of hops, the logo's little book as the thread through every scene.

```
<inputs>
Ask me for: the opening question, the book to zoom into, 3–4 hops that run forward (Book A
mentions Book B, which mentions Book C… each a real line from the book's text), and a track with
a clear beat (or a tempo to cut to).
Defaults: "Have you ever wondered how books are connected?" · The Marriage Plot → Invisible Cities
→ Brave New World → Romeo and Juliet · 120 BPM. No stats anywhere.
</inputs>

<direction>
A playful 2D motion film for BookJumpr, a site that maps the books mentioned inside other books.
16:9 master with a 9:16 cut. Warm paper (#f7f5f0), near-black ink (#141414), editorial serif
(Instrument Serif), mono labels (IBM Plex Mono), flat genre-coloured covers. One accent: rust
(#9c3d22). The star is the little rust book from the BookJumpr logo: it hops word to word, cover
to cover, star to star, and lands on the logo at the end. Bouncy springs with overshoot, squash
and stretch, tilt-and-settle, covers that wiggle when they're waiting to be picked.
Banned: stock footage, gradients, glows, particle bursts, 3D, and any movement that doesn't grow
from something already on screen. No numbers or stats.
</direction>

<structure>
About 18 seconds at 120 BPM (12 beats of intro, 4.5 a hop, 10 to finish).
Question (beats 0–6): "Have you ever wondered how books are connected?" pops in word by word on
  the beat; the little book hops along the words like a karaoke ball and lands on the "?".
Big view (6–10): the words shrink away as a wall of covers ripples out from the middle and
  drifts; the book hops across a few covers, browsing.
Zoom (10–12): a cursor taps the first book; the camera dives in until it's centre stage.
Hops (from beat 12, 4.5 beats each): each book mentions the next — the next book pops in with a wobble; a speech bubble grows out of the
  book that says the line, its tail pointing at it; the line types in and the named title is
  swiped with a rust highlighter; the little book leaps along a dotted arc onto the next cover
  (squash on landing) and the last one slides into a trail of jumps along the bottom.
Network (after the last hop, 5 beats): the trail becomes dots at their real places on the site's map, joined by
  the dotted path, and the camera pulls back to every book at once.
End (5 more beats): the stars gather into the logo's dotted arc, the book lands on its end, "BookJumpr"
  bounces in letter by letter, then "bookjumpr.com".
</structure>

<build>
1. One HTML file, 1920×1080 (plus a 1080×1920 layout from the same timeline), 60 fps. Compute
   every visual from time inside seek(t): no CSS transitions, timers or state between frames.
2. One closed-form spring for every pop and settle; a closed-form squash for every landing.
3. Every hop follows the logo's arc shape (a quadratic, raised in the middle), drawn as a dotted
   line just ahead of the book.
4. Lay the quote out once; find the named title in its words (ignore case and hyphens) for the
   highlighter.
5. The map uses the site's real positions and genre colours.
6. Render one still per scene before the full export.
</build>

<gotchas>
Every hop runs forward (the book on screen mentions the next). Quotes must be verbatim from the
data, and the bubble's tail must point at the book that says the line. The little book must be one continuous character — never pop in or vanish. Keep every
title and bubble inside the frame in both formats.
</gotchas>

<start>
Ask me for the inputs, then show me the beat map and stills (question, wall, zoom, a hop, the
last hop, the network, the end card) before building the full video.
</start>
```
