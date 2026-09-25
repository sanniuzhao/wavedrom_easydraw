# easydraw 交互式波形编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-repo web editor that draws WaveDrom timing diagrams by mouse, with two-way WaveJSON text sync, undo/redo, and export — without touching the rendering engine.

**Architecture:** Three layers: model (WaveJSON object + atomic ops, pure logic in `lib/easydraw/model.js`), render (existing `renderAny` + `onml/stringify`, unchanged), interaction (hit-grid overlay rebuilt after every full re-render). Every edit: mutate model → full re-render → refresh geometry → serialize to text panel → autosave.

**Tech Stack:** Node >= 20, existing deps only (`json5`, `onml`, esbuild, mocha, chai, c8, eslint 9 with `@drom/eslint-config`).

**Spec:** `docs/superpowers/specs/2026-09-25-easydraw-interactive-editor-design.md`

## Global Constraints

- Zero modification to any existing file under `lib/`, `bin/cli.js`, `test/*` existing files, and existing `package.json` script entries. Only NEW script keys (`editor`, `watch.editor`) may be added.
- No new npm dependencies.
- Code style: 4-space indent, single quotes, semicolons, `'use strict';` header — must pass `npx eslint lib bin` (repo config).
- Engine facts locked by probes (2026-09-25, default skin, no `hscale`):
  - One wave character = 2 bricks = `2 * lane.xs` px (default skin: 40px). Row height = `lane.yo` (30). Waveform origin: `wavelane_0_0` group absolute translate **(40.5, 5.5)** without head, **(40.5, 51.5)** with `head:{text:['HEAD']}`.
  - Data slots: every `=` character consumes one `data` item (verified: wave `x.==.=x` + data `[A,B,C,E]` renders exactly 3 labels A/B/C). Digits `2`–`9` also consume data items. `.` after `=` extends the previous item visually, consuming nothing.
  - Skin selection: `doc.config = {skin: '<name>'}` + merged skins object passed to `renderAny`.
- Editor writes only `=` for bus (no digit bricks) — spec §6.
- UI copy and code comments in English (repo convention).
- Commit messages: conventional style (`feat:`, `test:`, `docs:`, `chore:`), one logical change per commit.

## Review Focus

The five input classes most likely to bite a user, each pinned by a test in its owning task:

1. **Invalid JSON5 in the text panel while the user keeps typing** — canvas edits must be blocked, not clobber the half-typed text. → Task 6, `test/easydraw-textsync.js` `editableState` tests.
2. **Pasting an `assign` or `reg` document** — canvas must go read-only, not crash. → Task 6, `parseSource` mode tests.
3. **Trimming cycles that cut a bus segment** — orphaned `data` items must be removed. → Task 3, `resizeCycles` trim tests.
4. **Non-default skins change geometry** (narrow skins change `lane.xs`) — hit-testing must use extracted geometry, never hardcoded 40px. → Task 4, narrow-skin round-trip test.
5. **Corrupt/unreadable localStorage payload on startup** — editor must fall back to the starter doc, not throw. → Task 10, `restoreDoc` tests.

---

### Task 1: model.js — model creation, wave-char editing, serialization

**Files:**
- Create: `lib/easydraw/model.js`
- Test: `test/easydraw-model.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 2, 3, 5, 7, 8, 9, 10):
  - `createModel()` → fresh doc object
  - `serialize(doc)` → `JSON.stringify(doc, null, 2)`
  - `cycleCount(doc)` → number (max wave length)
  - `setCycle(doc, row, cycle, ch)` → `true` if applied; pads with `.` up to `cycle`; allowed `ch` ∈ `01xzpnPN.|`

- [ ] **Step 1: Write the failing test**

```js
// test/easydraw-model.js
'use strict';

var model = require('../lib/easydraw/model.js');
var chai = require('chai');
var expect = chai.expect;

describe('easydraw model: wave chars', function () {
    it('creates a starter model with signal array', function () {
        var doc = model.createModel();
        expect(doc.signal).to.be.an('array');
        expect(doc.signal.length).to.be.at.least(1);
    });
    it('setCycle overwrites an existing char', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.......' }] };
        expect(model.setCycle(doc, 0, 2, 'x')).to.equal(true);
        expect(doc.signal[0].wave).to.equal('p.x.....');
    });
    it('setCycle pads with dots when writing beyond the end', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.' }] };
        model.setCycle(doc, 0, 5, '1');
        expect(doc.signal[0].wave).to.equal('p....1.');
    });
    it('setCycle rejects chars outside the palette', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.' }] };
        expect(model.setCycle(doc, 0, 0, 'Q')).to.equal(false);
        expect(model.setCycle(doc, 0, 0, '3')).to.equal(false);
        expect(doc.signal[0].wave).to.equal('p.');
    });
    it('setCycle rejects out-of-range rows', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.' }] };
        expect(model.setCycle(doc, 7, 0, '1')).to.equal(false);
    });
    it('cycleCount is the max wave length', function () {
        var doc = { signal: [{ name: 'a', wave: 'p...' }, {}, { name: 'b', wave: '01' }] };
        expect(model.cycleCount(doc)).to.equal(4);
    });
    it('serialize round-trips through JSON.parse', function () {
        var doc = model.createModel();
        expect(JSON.parse(model.serialize(doc))).to.deep.equal(doc);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-model.js`
Expected: FAIL — `Cannot find module '../lib/easydraw/model.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// lib/easydraw/model.js
'use strict';

const CHARS = '01xzpnPN.|';

const STARTER = { signal: [
    { name: 'clk',  wave: 'p.......' },
    { name: 'req',  wave: '0.......' },
    { name: 'data', wave: 'x..==..x', data: ['A', 'B'] }
]};

function createModel () {
    return JSON.parse(JSON.stringify(STARTER));
}

function serialize (doc) {
    return JSON.stringify(doc, null, 2);
}

function cycleCount (doc) {
    return doc.signal.reduce(function (m, s) {
        return Math.max(m, (s && s.wave) ? s.wave.length : 0);
    }, 0);
}

function setCycle (doc, row, cycle, ch) {
    if (CHARS.indexOf(ch) < 0) { return false; }
    const sig = doc.signal[row];
    if (!sig) { return false; }
    let w = sig.wave || '';
    while (w.length < cycle) { w += '.'; }
    sig.wave = w.slice(0, cycle) + ch + w.slice(cycle + 1);
    return true;
}

module.exports = {
    createModel: createModel,
    serialize: serialize,
    cycleCount: cycleCount,
    setCycle: setCycle
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha test/easydraw-model.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Lint and commit**

```bash
npx eslint lib/easydraw/model.js
git add lib/easydraw/model.js test/easydraw-model.js
git commit -m "feat(easydraw): model wave-char editing with tests"
```

---

### Task 2: model.js — signal row management

**Files:**
- Modify: `lib/easydraw/model.js`
- Test: `test/easydraw-model.js` (append describe block)

**Interfaces:**
- Consumes: `cycleCount` from Task 1.
- Produces (used by Task 9 UI):
  - `addSignal(doc, afterIdx, name)` — inserts `{name, wave}` after `afterIdx`; wave padded with `.` to `cycleCount(doc)`; name made unique (`sig`, `sig2`, …) when omitted
  - `removeSignal(doc, row)` → `false` if it would empty `doc.signal`, else `true`
  - `renameSignal(doc, row, name)` → `true`/`false`
  - `moveSignal(doc, from, to)` → `true`/`false` (array splice, both bounds valid)
  - `insertSeparator(doc, afterIdx)` — inserts `{}`

- [ ] **Step 1: Write the failing test (append to test/easydraw-model.js)**

```js
describe('easydraw model: row management', function () {
    it('addSignal inserts a padded row after the given index', function () {
        var doc = { signal: [{ name: 'a', wave: 'p...' }] };
        model.addSignal(doc, 0);
        expect(doc.signal.length).to.equal(2);
        expect(doc.signal[1].wave).to.equal('....');
        expect(doc.signal[1].name).to.equal('sig');
    });
    it('addSignal makes names unique', function () {
        var doc = { signal: [{ name: 'sig', wave: 'p' }, { name: 'sig2', wave: 'p' }] };
        model.addSignal(doc, 1);
        expect(doc.signal[2].name).to.equal('sig3');
    });
    it('removeSignal refuses to empty the signal list', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        expect(model.removeSignal(doc, 0)).to.equal(false);
        expect(doc.signal.length).to.equal(1);
    });
    it('removeSignal removes and returns true', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }, { name: 'b', wave: 'p' }] };
        expect(model.removeSignal(doc, 0)).to.equal(true);
        expect(doc.signal[0].name).to.equal('b');
    });
    it('renameSignal updates the name', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        expect(model.renameSignal(doc, 0, 'clk2x')).to.equal(true);
        expect(doc.signal[0].name).to.equal('clk2x');
        expect(model.renameSignal(doc, 9, 'x')).to.equal(false);
    });
    it('moveSignal reorders rows', function () {
        var doc = { signal: [{ name: 'a' }, {}, { name: 'b' }] };
        expect(model.moveSignal(doc, 2, 0)).to.equal(true);
        expect(doc.signal[0].name).to.equal('b');
        expect(doc.signal[1]).to.deep.equal({});
    });
    it('insertSeparator adds an empty row', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        model.insertSeparator(doc, 0);
        expect(doc.signal[1]).to.deep.equal({});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-model.js`
Expected: FAIL — `model.addSignal is not a function`

- [ ] **Step 3: Implement (append to lib/easydraw/model.js, add to module.exports)**

```js
function uniqueName (doc) {
    const names = {};
    doc.signal.forEach(function (s) { if (s && s.name) { names[s.name] = true; } });
    let n = 'sig';
    let i = 1;
    while (names[n]) { i += 1; n = 'sig' + i; }
    return n;
}

function addSignal (doc, afterIdx, name) {
    const wave = '.'.repeat(cycleCount(doc));
    doc.signal.splice(afterIdx + 1, 0, {
        name: name || uniqueName(doc),
        wave: wave
    });
    return true;
}

function removeSignal (doc, row) {
    if (doc.signal.length <= 1) { return false; }
    if (row < 0 || row >= doc.signal.length) { return false; }
    doc.signal.splice(row, 1);
    return true;
}

function renameSignal (doc, row, name) {
    const sig = doc.signal[row];
    if (!sig || !name) { return false; }
    sig.name = name;
    return true;
}

function moveSignal (doc, from, to) {
    if (from < 0 || from >= doc.signal.length) { return false; }
    if (to < 0 || to >= doc.signal.length) { return false; }
    doc.signal.splice(to, 0, doc.signal.splice(from, 1)[0]);
    return true;
}

function insertSeparator (doc, afterIdx) {
    doc.signal.splice(afterIdx + 1, 0, {});
    return true;
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx mocha test/easydraw-model.js` → PASS (14 tests)
Run: `npx eslint lib/easydraw/model.js`

```bash
git add lib/easydraw/model.js test/easydraw-model.js
git commit -m "feat(easydraw): signal row management ops"
```

---

### Task 3: model.js — bus values and cycle resize (engine-locked)

**Files:**
- Modify: `lib/easydraw/model.js`
- Test: `test/easydraw-model.js` (append describe block)

**Interfaces:**
- Consumes: Task 1/2 model API.
- Produces:
  - `dataSlots(wave)` → number of data-consuming chars (`=` and `2`–`9`)
  - `setBusValue(doc, row, cycle, text)` — writes `=` at `cycle` (bypasses palette check) and sets the matching `data` item, extending the array with `''` when needed
  - `resizeCycles(doc, n)` — pad all waves with `.` / trim to `n`; after trim, truncate each signal's `data` to its remaining `dataSlots`

- [ ] **Step 1: Write the failing test (append)**

```js
describe('easydraw model: bus and cycles', function () {
    it('dataSlots counts = and digit chars', function () {
        expect(model.dataSlots('x.==.=x')).to.equal(3);
        expect(model.dataSlots('x.345x')).to.equal(3);
        expect(model.dataSlots('01.zx|')).to.equal(0);
    });
    it('ENGINE LOCK: x.==.=x renders exactly 3 data labels (A,B,C)', function () {
        var renderAny = require('../lib/render-any.js');
        var out = renderAny(0, { signal: [{ name: 'D', wave: 'x.==.=x', data: ['A', 'B', 'C', 'E'] }] },
            require('../skins/default.js'));
        var labels = [];
        (function walk (n) {
            if (!Array.isArray(n)) { return; }
            if (n[0] === 'text' && n[1].x !== undefined && +n[1].x > 0) {
                labels.push(JSON.stringify(n.slice(2)));
            }
            n.slice(2).forEach(walk);
        })(out);
        var hits = labels.filter(function (t) { return /A|B|C/.test(t); });
        expect(hits.length).to.equal(3);
    });
    it('setBusValue writes = and the matching data item', function () {
        var doc = { signal: [{ name: 'b', wave: 'x.......' }] };
        model.setBusValue(doc, 0, 2, 'HELLO');
        expect(doc.signal[0].wave).to.equal('x.=.....');
        expect(doc.signal[0].data).to.deep.equal(['HELLO']);
    });
    it('setBusValue extending beyond data length pads with empty strings', function () {
        var doc = { signal: [{ name: 'b', wave: 'x.=.....', data: ['A'] }] };
        model.setBusValue(doc, 0, 5, 'B2');
        expect(doc.signal[0].wave).to.equal('x.=..=..');
        expect(doc.signal[0].data).to.deep.equal(['A', 'B2']);
    });
    it('resizeCycles pads all waves', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.' }, { name: 'b', wave: '01' }] };
        model.resizeCycles(doc, 5);
        expect(doc.signal[0].wave).to.equal('p....');
        expect(doc.signal[1].wave).to.equal('01...');
    });
    it('resizeCycles trim removes orphaned data items', function () {
        var doc = { signal: [{ name: 'b', wave: 'x.==.=..', data: ['A', 'B', 'C'] }] };
        model.resizeCycles(doc, 4);           // wave becomes 'x.==' → 2 slots
        expect(doc.signal[0].wave).to.equal('x.==');
        expect(doc.signal[0].data).to.deep.equal(['A', 'B']);
    });
    it('resizeCycles refuses zero', function () {
        var doc = { signal: [{ name: 'a', wave: 'p.' }] };
        expect(model.resizeCycles(doc, 0)).to.equal(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-model.js`
Expected: FAIL — `model.dataSlots is not a function`

- [ ] **Step 3: Implement (append, export)**

```js
function dataSlots (wave) {
    const m = String(wave || '').match(/[=2-9]/g);
    return m ? m.length : 0;
}

function setBusValue (doc, row, cycle, text) {
    const sig = doc.signal[row];
    if (!sig) { return false; }
    let w = sig.wave || '';
    while (w.length < cycle) { w += '.'; }
    w = w.slice(0, cycle) + '=' + w.slice(cycle + 1);
    sig.wave = w;
    const slot = dataSlots(w.slice(0, cycle + 1)) - 1;
    if (!Array.isArray(sig.data)) { sig.data = []; }
    while (sig.data.length <= slot) { sig.data.push(''); }
    sig.data[slot] = text;
    return true;
}

function resizeCycles (doc, n) {
    if (n <= 0) { return false; }
    doc.signal.forEach(function (sig) {
        if (!sig || !sig.wave) { return; }
        let w = sig.wave;
        while (w.length < n) { w += '.'; }
        w = w.slice(0, n);
        sig.wave = w;
        if (Array.isArray(sig.data) && sig.data.length > dataSlots(w)) {
            sig.data = sig.data.slice(0, dataSlots(w));
        }
    });
    return true;
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx mocha test/easydraw-model.js` → PASS (21 tests)
Run: `npx eslint lib/easydraw/model.js`

```bash
git add lib/easydraw/model.js test/easydraw-model.js
git commit -m "feat(easydraw): bus value and cycle resize ops, engine-locked alignment tests"
```

---

### Task 4: geometry.js — geometry extraction and hit-testing

**Files:**
- Create: `lib/easydraw/geometry.js`
- Test: `test/easydraw-geometry.js`

**Interfaces:**
- Consumes: `renderAny` output (onml tree) + `lib/lane.js` singleton state (read-only, post-render).
- Produces (used by Task 8 interact):
  - `extractGeometry(onmlTree, lane)` → `{x0, y0, cycleWidth, rowHeight}` — origin = absolute translate of group `wavelane_0_0` INCLUDING its own transform; `cycleWidth = 2 * lane.xs`; `rowHeight = lane.yo`
  - `hitTest(geom, x, y)` → `{row, cycle}` or `null`

- [ ] **Step 1: Write the failing test**

```js
// test/easydraw-geometry.js
'use strict';

var renderAny = require('../lib/render-any.js');
var lane = require('../lib/lane.js');
var geometry = require('../lib/easydraw/geometry.js');
var chai = require('chai');
var expect = chai.expect;

function render (doc) {
    return renderAny(0, doc, require('../skins/default.js'));
}

describe('easydraw geometry', function () {
    it('extracts locked origin for a plain document (40.5, 5.5)', function () {
        var g = geometry.extractGeometry(render({ signal: [{ name: 'clk', wave: 'p.......' }] }), lane);
        expect(g.x0).to.equal(40.5);
        expect(g.y0).to.equal(5.5);
        expect(g.cycleWidth).to.equal(40);
        expect(g.rowHeight).to.equal(30);
    });
    it('extracts locked origin with a head present (40.5, 51.5)', function () {
        var g = geometry.extractGeometry(render({ head: { text: ['HEAD'] }, signal: [{ name: 'clk', wave: 'p.......' }] }), lane);
        expect(g.x0).to.equal(40.5);
        expect(g.y0).to.equal(51.5);
    });
    it('hitTest round-trips rows and cycles', function () {
        var g = geometry.extractGeometry(render({ signal: [
            { name: 'a', wave: 'p.......' }, {}, { name: 'b', wave: 'p.......' }
        ] }), lane);
        expect(geometry.hitTest(g, g.x0 + 0 * g.cycleWidth + 5, g.y0 + 0 * g.rowHeight + 15)).to.deep.equal({ row: 0, cycle: 0 });
        expect(geometry.hitTest(g, g.x0 + 3 * g.cycleWidth + 5, g.y0 + 2 * g.rowHeight + 15)).to.deep.equal({ row: 2, cycle: 3 });
        expect(geometry.hitTest(g, g.x0 - 5, g.y0 + 15)).to.equal(null);
    });
    it('narrow skin changes cycle width and hit-testing follows', function () {
        var out = renderAny(0, { signal: [{ name: 'clk', wave: 'p.......' }] }, require('../skins/narrow.js'));
        var g = geometry.extractGeometry(out, lane);
        expect(g.cycleWidth).to.equal(2 * lane.xs);
        expect(g.cycleWidth).to.not.equal(40);
        expect(geometry.hitTest(g, g.x0 + 2 * g.cycleWidth + 1, g.y0 + 15)).to.deep.equal({ row: 0, cycle: 2 });
    });
    it('returns null geometry for trees without a wavelane', function () {
        expect(geometry.extractGeometry(['svg', {}, ['g', {}]], lane)).to.equal(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-geometry.js`
Expected: FAIL — `Cannot find module '../lib/easydraw/geometry.js'`

- [ ] **Step 3: Implement**

```js
// lib/easydraw/geometry.js
'use strict';

function findChain (node, pred, chain) {
    if (!Array.isArray(node)) { return null; }
    if (pred(node)) { return chain.concat([node]); }
    for (let i = 2; i < node.length; i += 1) {
        const found = findChain(node[i], pred, chain.concat([node]));
        if (found) { return found; }
    }
    return null;
}

function extractGeometry (onmlTree, lane) {
    const chain = findChain(onmlTree, function (n) {
        return n[0] === 'g' && n[1] && n[1].id === 'wavelane_0_0';
    }, []);
    if (!chain) { return null; }
    let x = 0;
    let y = 0;
    chain.forEach(function (g) {
        const t = g[1] && g[1].transform;
        if (t) {
            const m = String(t).match(/translate\(([-\d.]+)(?:[ ,]([-\d.]+))?\)/);
            if (m) {
                x += parseFloat(m[1]);
                y += parseFloat(m[2] || '0');
            }
        }
    });
    return {
        x0: x,
        y0: y,
        cycleWidth: 2 * lane.xs,
        rowHeight: lane.yo
    };
}

function hitTest (geom, x, y) {
    if (!geom) { return null; }
    const cycle = Math.floor((x - geom.x0) / geom.cycleWidth);
    const row = Math.floor((y - geom.y0) / geom.rowHeight);
    if (cycle < 0 || row < 0) { return null; }
    return { row: row, cycle: cycle };
}

module.exports = {
    extractGeometry: extractGeometry,
    hitTest: hitTest
};
```

Note: `lane` is a mutable singleton shared by every render in the process — always call `extractGeometry` immediately after `renderAny`, before any other render.

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx mocha test/easydraw-geometry.js` → PASS (5 tests)
Run: `npx eslint lib/easydraw/geometry.js`

```bash
git add lib/easydraw/geometry.js test/easydraw-geometry.js
git commit -m "feat(easydraw): geometry extraction and hit-testing, skin-agnostic"
```

---

### Task 5: model.js — undo/redo history

**Files:**
- Modify: `lib/easydraw/model.js`
- Test: `test/easydraw-model.js` (append describe block)

**Interfaces:**
- Produces: `createHistory(cap = 100)` → `{commit(doc), undo(current) → doc|null, redo(current) → doc|null, canUndo(), canRedo()}` — snapshots are deep JSON clones; `commit` clears the redo stack.

- [ ] **Step 1: Write the failing test (append)**

```js
describe('easydraw model: history', function () {
    it('undo restores the previous snapshot', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        var h = model.createHistory();
        h.commit(doc);
        doc.signal[0].wave = 'p1';
        var back = h.undo(doc);
        expect(back.signal[0].wave).to.equal('p');
    });
    it('redo restores the undone change', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        var h = model.createHistory();
        h.commit(doc);
        doc.signal[0].wave = 'p1';
        h.undo(doc);
        var fwd = h.redo(doc);
        expect(fwd.signal[0].wave).to.equal('p1');
    });
    it('commit clears the redo stack', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        var h = model.createHistory();
        h.commit(doc);
        doc.signal[0].wave = 'p1';
        h.undo(doc);
        doc.signal[0].wave = 'px';
        h.commit(doc);
        expect(h.redo(doc)).to.equal(null);
    });
    it('undo with empty stack returns null', function () {
        expect(model.createHistory().undo({ signal: [] })).to.equal(null);
    });
    it('snapshots are decoupled from later mutation', function () {
        var doc = { signal: [{ name: 'a', wave: 'p', data: ['x'] }] };
        var h = model.createHistory();
        h.commit(doc);
        doc.signal[0].data.push('y');
        var back = h.undo(doc);
        expect(back.signal[0].data).to.deep.equal(['x']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-model.js`
Expected: FAIL — `model.createHistory is not a function`

- [ ] **Step 3: Implement (append, export)**

```js
function createHistory (cap) {
    const limit = cap || 100;
    const undoStack = [];
    let redoStack = [];
    return {
        commit: function (doc) {
            undoStack.push(JSON.stringify(doc));
            if (undoStack.length > limit) { undoStack.shift(); }
            redoStack = [];
        },
        undo: function (current) {
            if (!undoStack.length) { return null; }
            redoStack.push(JSON.stringify(current));
            return JSON.parse(undoStack.pop());
        },
        redo: function (current) {
            if (!redoStack.length) { return null; }
            undoStack.push(JSON.stringify(current));
            return JSON.parse(redoStack.pop());
        },
        canUndo: function () { return undoStack.length > 0; },
        canRedo: function () { return redoStack.length > 0; }
    };
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx mocha test/easydraw-model.js` → PASS (26 tests)
Run: `npx eslint lib/easydraw/model.js`

```bash
git add lib/easydraw/model.js test/easydraw-model.js
git commit -m "feat(easydraw): snapshot undo/redo history"
```

---

### Task 6: textsync.js — text parsing, validation, edit-state rules

**Files:**
- Create: `lib/easydraw/textsync.js`
- Test: `test/easydraw-textsync.js`

**Interfaces:**
- Consumes: `json5` (existing dependency).
- Produces (used by Task 7 editor):
  - `parseSource(text)` → `{ok: true, doc, mode: 'edit'}` for valid `signal` docs; `{ok: true, doc, mode: 'readonly'}` for `assign`/`reg` docs; `{ok: false, error}` otherwise
  - `editableState(lastParse, textDirty)` → `true` only when `lastParse.ok && lastParse.mode === 'edit' && !textDirty`

- [ ] **Step 1: Write the failing test**

```js
// test/easydraw-textsync.js
'use strict';

var textsync = require('../lib/easydraw/textsync.js');
var chai = require('chai');
var expect = chai.expect;

describe('easydraw textsync', function () {
    it('parses a valid signal document into edit mode', function () {
        var r = textsync.parseSource('{ signal: [{ name: "clk", wave: "p.." }] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('edit');
        expect(r.doc.signal[0].name).to.equal('clk');
    });
    it('parses json5 syntax (unquoted keys, trailing commas)', function () {
        var r = textsync.parseSource('{ signal: [ { name: \'a\', wave: \'p.\', }, ], }');
        expect(r.ok).to.equal(true);
    });
    it('syntax errors return ok:false with a message', function () {
        var r = textsync.parseSource('{ signal: [');
        expect(r.ok).to.equal(false);
        expect(r.error).to.be.a('string');
    });
    it('non-object roots are rejected', function () {
        expect(textsync.parseSource('[1,2,3]').ok).to.equal(false);
    });
    it('signal must be an array', function () {
        expect(textsync.parseSource('{ signal: 5 }').ok).to.equal(false);
    });
    it('assign documents parse into readonly mode', function () {
        var r = textsync.parseSource('{ assign: [ ["a", "b"] ] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('readonly');
    });
    it('reg documents parse into readonly mode', function () {
        var r = textsync.parseSource('{ reg: [] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('readonly');
    });
    it('documents without signal/assign/reg are rejected', function () {
        expect(textsync.parseSource('{ foo: 1 }').ok).to.equal(false);
    });
});

describe('easydraw textsync: editableState (Review Focus 1+2)', function () {
    it('edit mode and clean text → editable', function () {
        expect(textsync.editableState({ ok: true, mode: 'edit' }, false)).to.equal(true);
    });
    it('dirty text (user typing) blocks canvas edits', function () {
        expect(textsync.editableState({ ok: true, mode: 'edit' }, true)).to.equal(false);
    });
    it('invalid text blocks canvas edits', function () {
        expect(textsync.editableState({ ok: false, error: 'boom' }, false)).to.equal(false);
    });
    it('readonly mode blocks canvas edits', function () {
        expect(textsync.editableState({ ok: true, mode: 'readonly' }, false)).to.equal(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/easydraw-textsync.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// lib/easydraw/textsync.js
'use strict';

const json5 = require('json5');

function parseSource (text) {
    let doc;
    try {
        doc = json5.parse(text);
    } catch (e) {
        return { ok: false, error: e.message };
    }
    if (Object.prototype.toString.call(doc) !== '[object Object]') {
        return { ok: false, error: 'the root has to be an object: "{signal:[...]}"' };
    }
    if (doc.signal !== undefined) {
        if (!Array.isArray(doc.signal)) {
            return { ok: false, error: '"signal" has to be an array: "signal:[]"' };
        }
        return { ok: true, doc: doc, mode: 'edit' };
    }
    if (doc.assign !== undefined) {
        if (!Array.isArray(doc.assign)) {
            return { ok: false, error: '"assign" has to be an array: "assign:[]"' };
        }
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    if (doc.reg !== undefined) {
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    return { ok: false, error: '"signal:[...]", "assign:[...]" or "reg" property is missing' };
}

function editableState (lastParse, textDirty) {
    return Boolean(lastParse && lastParse.ok && lastParse.mode === 'edit' && !textDirty);
}

module.exports = {
    parseSource: parseSource,
    editableState: editableState
};
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx mocha test/easydraw-textsync.js` → PASS (12 tests)
Run: `npx eslint lib/easydraw/textsync.js`

```bash
git add lib/easydraw/textsync.js test/easydraw-textsync.js
git commit -m "feat(easydraw): text panel parse/validate and editable-state rules"
```

---

### Task 7: build scripts + editor page skeleton + render loop

**Files:**
- Create: `editor/easydraw.html`, `editor/easydraw.css`, `lib/easydraw/editor.js`
- Modify: `package.json` (ADD two script keys only: `editor`, `watch.editor`)

**Interfaces:**
- Consumes: `renderAny`, `onml/stringify.js`, `lib/lane.js`, `geometry.js`, `model.js`, `textsync.js`, `window.WaveSkin` (set by skin script tags).
- Produces: a running page; `lib/easydraw/editor.js` exposes `window.easydrawBoot(config)` where config = `{canvasId, overlayId, textId, errorId, toolbarId}` — Task 8/9 extend the same boot function. Bundle output: `editor/wavedrom.editor.js`.

- [ ] **Step 1: Add build scripts (package.json "scripts", keep every existing entry untouched)**

```json
"editor": "esbuild ./lib/easydraw/editor.js --bundle --format=iife --outfile=editor/wavedrom.editor.js",
"watch.editor": "esbuild ./lib/easydraw/editor.js --bundle --format=iife --outfile=editor/wavedrom.editor.js --watch",
```

- [ ] **Step 2: Write the page**

```html
<!-- editor/easydraw.html -->
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>wavedrom_easydraw editor</title>
<script src="../skins/default.js"></script>
<script src="../skins/narrow.js"></script>
<script src="../skins/narrower.js"></script>
<script src="../skins/narrowerer.js"></script>
<script src="../skins/dark.js"></script>
<script src="../skins/lowkey.js"></script>
<link rel="stylesheet" href="easydraw.css">
</head>
<body>
<header id="ed-toolbar">
    <span class="ed-group" id="ed-tools"></span>
    <span class="ed-group" id="ed-rows"></span>
    <span class="ed-group" id="ed-cycles">
        <button id="ed-cycle-minus" title="remove cycle">cycle −</button>
        <span id="ed-cycle-count">0</span>
        <button id="ed-cycle-plus" title="add cycle">cycle +</button>
    </span>
    <span class="ed-group">
        <select id="ed-skin">
            <option>default</option><option>narrow</option><option>narrower</option>
            <option>narrowerer</option><option>dark</option><option>lowkey</option>
        </select>
        <input id="ed-head" placeholder="head text">
        <input id="ed-foot" placeholder="foot text">
    </span>
    <span class="ed-group">
        <button id="ed-undo">↶</button>
        <button id="ed-redo">↷</button>
        <button id="ed-new">New</button>
    </span>
    <span class="ed-group">
        <button id="ed-export-svg">SVG</button>
        <button id="ed-export-png">PNG</button>
        <button id="ed-export-json">JSON5</button>
    </span>
</header>
<main id="ed-main">
    <div id="ed-canvas-wrap">
        <div id="ed-canvas"></div>
        <div id="ed-overlay"></div>
        <input id="ed-bus-input" type="text" hidden>
    </div>
    <aside id="ed-side">
        <textarea id="ed-text" spellcheck="false"></textarea>
        <div id="ed-error"></div>
    </aside>
</main>
<script src="wavedrom.editor.js"></script>
<script>window.easydrawBoot({
    canvasId: 'ed-canvas', overlayId: 'ed-overlay', textId: 'ed-text',
    errorId: 'ed-error', toolbarId: 'ed-toolbar', busInputId: 'ed-bus-input'
});</script>
</body>
</html>
```

```css
/* editor/easydraw.css */
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 Helvetica, Arial, sans-serif; display: flex; flex-direction: column; height: 100vh; }
#ed-toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 10px; background: #f5f5f5; border-bottom: 1px solid #ccc; }
#ed-toolbar .ed-group { display: inline-flex; gap: 4px; align-items: center; padding-right: 8px; border-right: 1px solid #ddd; }
#ed-toolbar button { padding: 2px 8px; cursor: pointer; }
#ed-toolbar button.on { background: #036; color: #fff; }
#ed-toolbar select, #ed-toolbar input { font-size: 12px; }
#ed-main { display: flex; flex: 1; min-height: 0; }
#ed-canvas-wrap { position: relative; flex: 1; overflow: auto; background: #fff; }
#ed-canvas svg { max-width: 100%; height: auto; display: block; }
#ed-overlay { position: absolute; inset: 0; cursor: crosshair; }
#ed-overlay .cell { position: absolute; border: 1px solid rgba(0,100,255,.8); background: rgba(0,100,255,.12); pointer-events: none; display: none; }
#ed-side { width: 340px; display: flex; flex-direction: column; border-left: 1px solid #ccc; }
#ed-text { flex: 1; resize: none; border: 0; padding: 8px; font: 12px/1.5 Menlo, Consolas, monospace; }
#ed-text.bad { background: #fdd; }
#ed-error { padding: 4px 8px; color: #c00; min-height: 20px; white-space: pre-wrap; }
#ed-bus-input { position: absolute; z-index: 10; font-size: 12px; padding: 1px 4px; }
```

- [ ] **Step 3: Write editor.js (render loop + boot; interaction lands in Task 8)**

```js
// lib/easydraw/editor.js
'use strict';

const renderAny = require('../render-any.js');
const stringify = require('onml/stringify.js');
const lane = require('../lane.js');
const geometry = require('./geometry.js');
const model = require('./model.js');
const textsync = require('./textsync.js');

function boot (cfg) {
    const canvas = document.getElementById(cfg.canvasId);
    const overlay = document.getElementById(cfg.overlayId);
    const textEl = document.getElementById(cfg.textId);
    const errorEl = document.getElementById(cfg.errorId);

    const ed = {
        doc: model.createModel(),
        skins: window.WaveSkin,
        geom: null,
        history: model.createHistory(),
        lastParse: { ok: true, mode: 'edit' },
        textDirty: false,
        mode: 'edit'
    };

    ed.render = function () {
        const tree = renderAny(0, ed.doc, ed.skins);
        canvas.innerHTML = stringify(tree);
        ed.geom = geometry.extractGeometry(tree, lane);
        const svgEl = canvas.querySelector('svg');
        ed.scale = svgEl && svgEl.viewBox && svgEl.viewBox.baseVal
            ? svgEl.getBoundingClientRect().width / svgEl.viewBox.baseVal.width
            : 1;
    };

    ed.syncText = function () {
        textEl.value = model.serialize(ed.doc);
        ed.textDirty = false;
        ed.lastParse = { ok: true, doc: ed.doc, mode: 'edit' };
        textEl.classList.remove('bad');
        errorEl.textContent = '';
    };

    ed.refresh = function () {
        ed.render();
        ed.syncText();
    };

    ed.refresh();
    window.ed = ed; // for console debugging and Task 8/9 wiring
    return ed;
}

module.exports = boot;
if (typeof window !== 'undefined') { window.easydrawBoot = boot; }
```

- [ ] **Step 4: Build and verify manually**

Run: `npm run editor`
Expected: `editor/wavedrom.editor.js` created, no errors.
Run: `npx eslint lib/easydraw/editor.js`
Manual: open `editor/easydraw.html` in a browser → starter diagram renders on the left, WaveJSON text on the right, no console errors. Type valid JSON in the text area — no crash (sync wiring comes in Task 9; only rendering must not break).

- [ ] **Step 5: Commit**

```bash
git add package.json editor/ lib/easydraw/editor.js
git commit -m "feat(easydraw): editor page skeleton, esbuild bundle, render loop"
```

---

### Task 8: interact.js — overlay, tools, painting, row selection

**Files:**
- Create: `lib/easydraw/interact.js`
- Modify: `lib/easydraw/editor.js` (wire overlay + toolbar tool buttons)

**Interfaces:**
- Consumes: `geometry.hitTest`, `ed.geom`, `ed.scale`, model ops (Tasks 1–3).
- Produces: `createInteract(ed, cfg)` attaches pointer handlers to `#overlay` and returns `{setTool(ch), setSelectedRow(i)}`. Toolbar tool buttons are generated from `TOOLS`.

- [ ] **Step 1: Write interact.js**

```js
// lib/easydraw/interact.js
'use strict';

const geometry = require('./geometry.js');

const TOOLS = [
    { ch: '1', label: '1' }, { ch: '0', label: '0' },
    { ch: 'x', label: 'x' }, { ch: 'z', label: 'z' },
    { ch: 'p', label: 'p' }, { ch: 'n', label: 'n' },
    { ch: 'P', label: 'P' }, { ch: 'N', label: 'N' },
    { ch: '.', label: '.' }, { ch: '|', label: '|' },
    { ch: '=', label: 'bus' }
];

function createInteract (ed, cfg) {
    const overlay = document.getElementById(cfg.overlayId);
    const canvasWrap = overlay.parentElement;
    const hover = document.createElement('div');
    hover.className = 'cell';
    overlay.appendChild(hover);

    let tool = '1';
    let painting = false;

    function toSvg (ev) {
        const rect = canvasWrap.getBoundingClientRect();
        return {
            x: (ev.clientX - rect.left + canvasWrap.scrollLeft) / ed.scale,
            y: (ev.clientY - rect.top + canvasWrap.scrollTop) / ed.scale
        };
    }

    function canEdit () {
        return textsync.editableState(ed.lastParse, ed.textDirty);
    }

    function applyAt (ev) {
        const p = toSvg(ev);
        const hit = geometry.hitTest(ed.geom, p.x, p.y);
        if (!hit || hit.row >= ed.doc.signal.length) { return; }
        ed.history.commit(ed.doc);
        if (tool === '=') {
            const sig = ed.doc.signal[hit.row];
            const w = sig.wave || '';
            const cellX = ed.geom.x0 + hit.cycle * ed.geom.cycleWidth;
            const cellW = ed.geom.cycleWidth * ed.scale;
            ed.openBusInput(hit.row, hit.cycle, cellX * ed.scale - canvasWrap.scrollLeft, cellW);
            ed.history.undo(ed.doc); // bus input commits on confirm, not on click
        } else {
            model.setCycle(ed.doc, hit.row, hit.cycle, tool);
            ed.refresh();
            ed.autosave();
        }
    }

    overlay.addEventListener('pointerdown', function (ev) {
        if (!canEdit()) { return; }
        painting = true;
        overlay.setPointerCapture(ev.pointerId);
        applyAt(ev);
    });
    overlay.addEventListener('pointermove', function (ev) {
        const p = toSvg(ev);
        const hit = geometry.hitTest(ed.geom, p.x, p.y);
        if (hit && hit.row < ed.doc.signal.length && canEdit()) {
            const s = ed.scale;
            hover.style.display = 'block';
            hover.style.left = (ed.geom.x0 + hit.cycle * ed.geom.cycleWidth) * s - canvasWrap.scrollLeft + 'px';
            hover.style.top = (ed.geom.y0 + hit.row * ed.geom.rowHeight) * s - canvasWrap.scrollTop + 'px';
            hover.style.width = ed.geom.cycleWidth * s + 'px';
            hover.style.height = ed.geom.rowHeight * s + 'px';
        } else {
            hover.style.display = 'none';
        }
        if (painting && tool !== '=') { applyAt(ev); }
    });
    overlay.addEventListener('pointerup', function () { painting = false; });

    // toolbar tool buttons
    const toolsEl = document.getElementById('ed-tools');
    TOOLS.forEach(function (t) {
        const b = document.createElement('button');
        b.textContent = t.label;
        b.dataset.tool = t.ch;
        if (t.ch === tool) { b.classList.add('on'); }
        b.addEventListener('click', function () {
            tool = t.ch;
            toolsEl.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
        });
        toolsEl.appendChild(b);
    });

    return {
        setTool: function (ch) { tool = ch; },
        getTool: function () { return tool; }
    };
}

module.exports = { createInteract: createInteract, TOOLS: TOOLS };
```

Note: `interact.js` references `textsync` — add `const textsync = require('./textsync.js');` at the top of the file (it was omitted above only to keep the listing focused; include it).

- [ ] **Step 2: Wire into editor.js boot (append before `return ed;`)**

```js
const interact = require('./interact.js');
// inside boot(), after ed.refresh():
ed.interact = interact.createInteract(ed, cfg);
ed.openBusInput = function (row, cycle, x, w) {
    const input = document.getElementById(cfg.busInputId);
    input.hidden = false;
    input.style.left = x + 'px';
    input.style.top = (ed.geom.y0 + row * ed.geom.rowHeight) * ed.scale + 'px';
    input.style.width = Math.max(60, w * 2) + 'px';
    input.value = '';
    input.focus();
    function done () {
        input.hidden = true;
        input.onkeydown = null;
        input.onblur = null;
    }
    input.onkeydown = function (ev) {
        if (ev.key === 'Enter') {
            ed.history.commit(ed.doc);
            model.setBusValue(ed.doc, row, cycle, input.value);
            done();
            ed.refresh();
            ed.autosave();
        } else if (ev.key === 'Escape') { done(); }
    };
    input.onblur = done;
};
```

(`ed.autosave` is defined in Task 10 — until then add a stub `ed.autosave = function () {};` in boot.)

- [ ] **Step 3: Build and verify manually**

Run: `npm run editor && npx eslint lib/easydraw/interact.js lib/easydraw/editor.js`
Manual (editor/easydraw.html): hover shows blue cell highlight tracking rows/cycles; clicking with tool `1` paints high levels; dragging paints continuously; `bus` tool opens the inline input and Enter writes an `=` + data item; separator rows are not editable (row ≥ signal length guard).

- [ ] **Step 4: Commit**

```bash
git add lib/easydraw/interact.js lib/easydraw/editor.js
git commit -m "feat(easydraw): overlay interaction, tool palette, drag painting, bus inline input"
```

---

### Task 9: row management UI, cycle +/−, properties panel

**Files:**
- Modify: `lib/easydraw/editor.js` (append UI wiring inside boot)

**Interfaces:**
- Consumes: model row ops (Task 2), `resizeCycles` (Task 3), `interact` selected row (Task 8 adds `ed.interact.setSelectedRow` — implement here: click on the label column x < `ed.geom.x0` selects row; store `ed.selectedRow`).

- [ ] **Step 1: Append wiring code inside boot (after interact creation)**

```js
// row selection: clicks left of the waveform column select the row
overlay.addEventListener('pointerdown', function (ev) {
    const p = { x: ev.clientX, y: ev.clientY };
    const rect = canvas.getBoundingClientRect();
    const y = (p.y - rect.top) / ed.scale;
    const row = Math.floor((y - ed.geom.y0) / ed.geom.rowHeight);
    if (p.x - rect.left < ed.geom.x0 * ed.scale && row >= 0 && row < ed.doc.signal.length) {
        ed.selectedRow = row;
        ed.renderRowButtons();
    }
});

ed.renderRowButtons = function () {
    const el = document.getElementById('ed-rows');
    el.innerHTML = '';
    const mk = function (label, fn, title) {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = title || '';
        b.disabled = !textsync.editableState(ed.lastParse, ed.textDirty);
        b.addEventListener('click', fn);
        el.appendChild(b);
    };
    const r = ed.selectedRow;
    const tag = document.createElement('span');
    tag.textContent = (r === undefined) ? 'no row' : ('row ' + r + (ed.doc.signal[r] && ed.doc.signal[r].name ? ': ' + ed.doc.signal[r].name : ' (separator)'));
    el.appendChild(tag);
    if (r === undefined) { return; }
    mk('rename', function () {
        const sig = ed.doc.signal[r];
        if (!sig || !sig.name) { return; }
        const name = window.prompt('signal name', sig.name);
        if (name) { ed.op(function () { model.renameSignal(ed.doc, r, name); }); }
    });
    mk('del', function () { ed.op(function () { model.removeSignal(ed.doc, r); }); }, 'delete row');
    mk('↑', function () { ed.op(function () { model.moveSignal(ed.doc, r, r - 1); ed.selectedRow = r - 1; }); });
    mk('↓', function () { ed.op(function () { model.moveSignal(ed.doc, r, r + 1); ed.selectedRow = r + 1; }); });
    mk('+sig', function () { ed.op(function () { model.addSignal(ed.doc, r); }); });
    mk('+sep', function () { ed.op(function () { model.insertSeparator(ed.doc, r); }); });
};

// single entry point for committing model changes from UI
ed.op = function (mutate) {
    if (!textsync.editableState(ed.lastParse, ed.textDirty)) { return; }
    ed.history.commit(ed.doc);
    mutate();
    ed.selectedRow = Math.min(ed.selectedRow === undefined ? undefined : ed.selectedRow, ed.doc.signal.length - 1);
    ed.refresh();
    ed.renderRowButtons();
    ed.autosave();
};

document.getElementById('ed-cycle-plus').addEventListener('click', function () {
    ed.op(function () { model.resizeCycles(ed.doc, model.cycleCount(ed.doc) + 1); });
});
document.getElementById('ed-cycle-minus').addEventListener('click', function () {
    ed.op(function () { model.resizeCycles(ed.doc, model.cycleCount(ed.doc) - 1); });
});

document.getElementById('ed-skin').addEventListener('change', function (ev) {
    ed.op(function () {
        if (ev.target.value === 'default') { delete ed.doc.config; }
        else { ed.doc.config = { skin: ev.target.value }; }
    });
});
document.getElementById('ed-head').addEventListener('change', function (ev) {
    ed.op(function () {
        if (ev.target.value === '') { delete ed.doc.head; }
        else { ed.doc.head = { text: [ev.target.value], tick: 0 }; }
    });
});
document.getElementById('ed-foot').addEventListener('change', function (ev) {
    ed.op(function () {
        if (ev.target.value === '') { delete ed.doc.foot; }
        else { ed.doc.foot = { text: [ev.target.value], tock: 0 }; }
    });
});

document.getElementById('ed-undo').addEventListener('click', function () {
    const back = ed.history.undo(ed.doc);
    if (back) { ed.doc = back; ed.refresh(); ed.renderRowButtons(); ed.autosave(); }
});
document.getElementById('ed-redo').addEventListener('click', function () {
    const fwd = ed.history.redo(ed.doc);
    if (fwd) { ed.doc = fwd; ed.refresh(); ed.renderRowButtons(); ed.autosave(); }
});

document.getElementById('ed-cycle-count').textContent = model.cycleCount(ed.doc);
```

Also update `ed.refresh` to keep the cycle counter fresh — add at the end of `ed.refresh`:
```js
const cc = document.getElementById('ed-cycle-count');
if (cc) { cc.textContent = model.cycleCount(ed.doc); }
```

- [ ] **Step 2: Build, lint, manual verify**

Run: `npm run editor && npx eslint lib/easydraw`
Manual: select row by clicking a signal name → rename/del/move/+sig/+sep all work and re-render; cycle +/− pad/trim; skin dropdown switches to narrow/dark and hit-testing still lands on the right cells (Review Focus 4 in the browser); head/foot text appears and click rows shift down with geometry following; undo/redo buttons restore states.

- [ ] **Step 3: Commit**

```bash
git add lib/easydraw/editor.js
git commit -m "feat(easydraw): row management UI, cycle controls, skin/head/foot panel, undo/redo buttons"
```

---

### Task 10: text two-way sync, autosave/restore, New button

**Files:**
- Modify: `lib/easydraw/model.js` (add `sanitizeSignalDoc`), `lib/easydraw/editor.js` (text panel wiring, autosave)

**Interfaces:**
- Produces: `model.sanitizeSignalDoc(doc)` → ensures `signal` is a non-empty array of objects with string `wave`s (drops other root kinds to `null`); `ed.autosave()`; localStorage key `easydraw.doc`.

- [ ] **Step 1: Write the failing test (append to test/easydraw-model.js)**

```js
describe('easydraw model: sanitize (Review Focus 5)', function () {
    it('fills missing wave with empty string', function () {
        var doc = model.sanitizeSignalDoc({ signal: [{ name: 'a' }] });
        expect(doc.signal[0].wave).to.equal('');
    });
    it('drops non-signal roots', function () {
        expect(model.sanitizeSignalDoc({ assign: [] })).to.equal(null);
        expect(model.sanitizeSignalDoc(5)).to.equal(null);
    });
    it('rejects empty signal arrays', function () {
        expect(model.sanitizeSignalDoc({ signal: [] })).to.equal(null);
    });
    it('coerces wave to string', function () {
        var doc = model.sanitizeSignalDoc({ signal: [{ name: 'a', wave: 123 }] });
        expect(doc.signal[0].wave).to.equal('123');
    });
});
```

- [ ] **Step 2: Run to verify it fails, then implement (model.js, export it)**

```js
function sanitizeSignalDoc (doc) {
    if (Object.prototype.toString.call(doc) !== '[object Object]') { return null; }
    if (!Array.isArray(doc.signal) || doc.signal.length === 0) { return null; }
    doc.signal.forEach(function (sig) {
        if (Object.prototype.toString.call(sig) !== '[object Object]') { return; }
        if (typeof sig.wave !== 'string') {
            sig.wave = (sig.wave === undefined || sig.wave === null) ? '' : String(sig.wave);
        }
    });
    return doc;
}
```

Run: `npx mocha test/easydraw-model.js` → PASS (30 tests)

- [ ] **Step 3: Wire text sync + autosave in editor.js boot (replace the Task 8 autosave stub)**

```js
const LS_KEY = 'easydraw.doc';

ed.autosave = function () {
    window.clearTimeout(ed._saveTimer);
    ed._saveTimer = window.setTimeout(function () {
        try { window.localStorage.setItem(LS_KEY, model.serialize(ed.doc)); } catch (e) { /* quota: ignore */ }
    }, 1000);
};

// restore on boot (replaces the plain createModel start when storage has a valid doc)
(function restore () {
    try {
        const raw = window.localStorage.getItem(LS_KEY);
        if (raw) {
            const r = textsync.parseSource(raw);
            const doc = r.ok ? model.sanitizeSignalDoc(r.doc) : null;
            if (doc) { ed.doc = doc; }
        }
    } catch (e) { /* corrupted storage: fall back to starter */ }
    ed.refresh();
})();

// text panel: debounced parse, two-way
let textTimer = null;
textEl.addEventListener('input', function () {
    ed.textDirty = true;
    textEl.classList.add('bad');
    window.clearTimeout(textTimer);
    textTimer = window.setTimeout(function () {
        const r = textsync.parseSource(textEl.value);
        ed.lastParse = r;
        if (r.ok && r.mode === 'edit') {
            const doc = model.sanitizeSignalDoc(r.doc);
            if (doc) {
                ed.doc = doc;
                ed.mode = 'edit';
                textEl.classList.remove('bad');
                errorEl.textContent = '';
                ed.render();
                ed.autosave();
                ed.renderRowButtons();
            }
        } else if (r.ok && r.mode === 'readonly') {
            ed.doc = r.doc;
            ed.mode = 'readonly';
            textEl.classList.remove('bad');
            errorEl.textContent = 'readonly: canvas editing supports signal documents only';
            ed.render();
            ed.autosave();
        } else {
            errorEl.textContent = r.error || 'parse error';
        }
    }, 300);
});

document.getElementById('ed-new').addEventListener('click', function () {
    if (!window.confirm('Discard current diagram and start a new one?')) { return; }
    ed.history.commit(ed.doc);
    ed.doc = model.createModel();
    ed.selectedRow = undefined;
    ed.mode = 'edit';
    ed.refresh();
    ed.renderRowButtons();
    ed.autosave();
});
```

Remove the initial `ed.refresh()` from Task 7 boot — `restore()` now does it.

- [ ] **Step 4: Build, lint, manual verify**

Run: `npm run editor && npx eslint lib/easydraw`
Manual (Review Focus 1, 2, 5 in the browser): type garbage into the text panel → panel turns red, error shows, canvas ops blocked; fix the text → canvas updates live; paste `{assign:[["a","b"]]}` → readonly banner, painting blocked; reload page → diagram restored; New → starter after confirm; invalid localStorage (`localStorage.setItem('easyroll.doc','{bad')` style corruption) → starter loads, no console error.

- [ ] **Step 5: Commit**

```bash
git add lib/easydraw/model.js lib/easydraw/editor.js test/easydraw-model.js
git commit -m "feat(easydraw): two-way text sync, autosave/restore, New button"
```

---

### Task 11: export SVG / PNG / JSON5

**Files:**
- Modify: `lib/easydraw/editor.js` (append export wiring in boot)

**Interfaces:**
- Consumes: rendered `#ed-canvas svg` (Task 7 render loop), `model.serialize`.

- [ ] **Step 1: Append export wiring**

```js
function downloadBlob (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 100);
}

document.getElementById('ed-export-svg').addEventListener('click', function () {
    const svg = canvas.querySelector('svg');
    if (!svg) { return; }
    const xml = '<?xml version="1.0" standalone="no"?>\n' + new XMLSerializer().serializeToString(svg);
    downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), 'wavedrom_easydraw.svg');
});

document.getElementById('ed-export-png').addEventListener('click', function () {
    const svg = canvas.querySelector('svg');
    if (!svg) { return; }
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = function () {
        const c = document.createElement('canvas');
        c.width = Math.ceil(svg.viewBox.baseVal.width * 2);
        c.height = Math.ceil(svg.viewBox.baseVal.height * 2);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { downloadBlob(b, 'wavedrom_easydraw.png'); });
    };
    img.src = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(xml)));
});

document.getElementById('ed-export-json').addEventListener('click', function () {
    downloadBlob(new Blob([model.serialize(ed.doc)], { type: 'application/json5' }), 'wavedrom_easydraw.json5');
});
```

- [ ] **Step 2: Build, lint, manual verify**

Run: `npm run editor && npx eslint lib/easydraw`
Manual: SVG button downloads a file that opens correctly in a browser; PNG button downloads a white-background raster of the diagram; JSON5 button downloads text identical to the text panel.

- [ ] **Step 3: Commit**

```bash
git add lib/easydraw/editor.js
git commit -m "feat(easydraw): SVG/PNG/JSON5 export"
```

---

### Task 12: final regression, README, smoke checklist

**Files:**
- Modify: `README.md` (add an "Editor" section after "CLI")
- Create: `docs/easydraw-smoke-checklist.md`

**Interfaces:** none (docs + verification).

- [ ] **Step 1: Full regression**

Run: `npm test`
Expected: eslint clean + all mocha tests pass (existing `test/signal.js`, `test/reg.js` untouched and green; new easydraw suites green).

Run: `npm run editor`
Expected: bundle builds clean.

Verify no existing file was modified: `git diff --stat trunk~12 -- lib bin test | grep -v easydraw` → empty (only `lib/easydraw/*`, `test/easydraw-*` new files, `package.json` scripts block).

- [ ] **Step 2: README section (insert after the "Export to PNG" block, before "## Web usage")**

```markdown
## Interactive Editor (easydraw)

Draw timing diagrams with the mouse instead of writing WaveJSON by hand:

```bash
npm run editor     # builds editor/wavedrom.editor.js
open editor/easydraw.html
```

Click cells to paint levels (`0 1 x z`), clocks (`p n P N`), gaps (`|`), and bus
values; manage signal rows; switch skins; edit `head`/`foot`; two-way sync with
the WaveJSON text panel; undo/redo; export SVG / PNG / JSON5. The rendering
engine is unchanged — everything the editor draws is plain WaveJSON.
```

- [ ] **Step 3: Smoke checklist (docs/easydraw-smoke-checklist.md)**

```markdown
# easydraw editor — manual smoke checklist

1. `npm run editor` then open `editor/easydraw.html` — starter diagram renders.
2. Tool `1`: click and drag over cells — levels paint; `0`, `x`, `z`, `p` ditto.
3. `bus` tool: click a cell, type text, Enter — `=` and data appear; Escape cancels.
4. Click a signal name (left column) — row buttons appear: rename/del/↑/↓/+sig/+sep all work.
5. `cycle +` / `cycle −` — all waves pad/trim; trimming a bus drops its orphan data.
6. Skin dropdown — narrow/dark render and click hit-testing stays aligned.
7. head/foot inputs — titles render, rows shift, hit-testing follows.
8. Text panel: paste invalid JSON5 — red + error, canvas blocked; fix it — live update.
9. Text panel: paste an `assign` document — readonly banner, painting blocked.
10. Reload the page — diagram restored from localStorage; New — starter after confirm.
11. Undo/redo across painting, row ops, and bus edits.
12. Export SVG / PNG / JSON5 — all three download and open correctly.
```

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/easydraw-smoke-checklist.md
git commit -m "docs(easydraw): editor usage and smoke checklist"
git push origin trunk
```

---

## Self-Review Notes (checked 2026-09-25)

- Spec coverage: §5 tools→Task 8; row mgmt→Task 9; bus→Tasks 3+8; cycles→Task 9; skin/head/foot→Task 9; readonly boundary→Task 6+10; §6 semantics→Tasks 1+3 (engine-locked); §7 two-way→Task 10; §8 geometry→Task 4; §9 export/persist→Tasks 10+11; §10 errors→Tasks 6+10; §11 tests→every task; §12 compatibility→Global Constraints + Task 12 regression. No gaps.
- Placeholder scan: none; every code step carries real code.
- Type consistency: `ed.refresh/ed.syncText/ed.autosave/ed.op/ed.renderRowButtons/ed.openBusInput` defined before use (Task 7 stub `autosave` replaced in Task 10); model/geometry/textsync signatures match across tasks.
- Review Focus: each of the 5 items has a pinned test or browser step in its owning task.
