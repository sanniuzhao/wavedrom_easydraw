# easydraw editor — manual smoke checklist

Run `npm run editor`, then open `editor/easydraw.html` in a browser and walk through:

1. Starter diagram renders; WaveJSON text panel shows the matching source.
2. Tool `1`: click and drag over cells — levels paint; `0`, `x`, `z`, `p` ditto.
3. `bus` tool: click a cell, type text, Enter — `=` and data appear; Escape cancels.
4. Click a signal name (left column) — row buttons appear: rename / del / ↑ / ↓ / +sig / +sep all work.
5. `cycle +` / `cycle −` — all waves pad/trim; trimming a bus drops its orphan data.
6. Skin dropdown — narrow/dark render and click hit-testing stays aligned.
7. head/foot inputs — titles render, rows shift, hit-testing follows.
8. Text panel: paste invalid JSON5 — red + error, canvas blocked; fix it — live update.
9. Text panel: paste an `assign` document — readonly banner, painting blocked.
10. Reload the page — diagram restored from localStorage; New — starter after confirm.
11. Undo/redo across painting, row ops, and bus edits (one undo per drag stroke).
12. Export SVG / PNG / JSON5 — all three download and open correctly.
