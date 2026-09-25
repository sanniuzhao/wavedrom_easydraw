'use strict';

const renderAny = require('../render-any.js');
const stringify = require('onml/stringify.js');
const lane = require('../lane.js');
const geometry = require('./geometry.js');
const model = require('./model.js');
const textsync = require('./textsync.js');
const interact = require('./interact.js');

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
        mode: 'edit',
        selectedRow: undefined
    };

    ed.render = function () {
        let tree;
        try {
            tree = renderAny(0, ed.doc, ed.skins);
        } catch (e) {
            tree = renderAny(0, { signal: [{ name: ['tspan', { class: 'error h5' }, 'Error: ' + e.message] }] }, ed.skins);
        }
        canvas.innerHTML = stringify(tree);
        ed.geom = geometry.extractGeometry(tree, lane);
        const svgEl = canvas.querySelector('svg');
        ed.scale = svgEl && svgEl.viewBox && svgEl.viewBox.baseVal
            ? svgEl.getBoundingClientRect().width / svgEl.viewBox.baseVal.width
            : 1;
        // size the overlay to the full content extent so pointer coverage
        // follows tall diagrams (review fix 3)
        overlay.style.width = canvas.offsetWidth + 'px';
        overlay.style.height = canvas.offsetHeight + 'px';
    };

    ed.syncText = function () {
        textEl.value = model.serialize(ed.doc);
        ed.textDirty = false;
        ed.lastParse = { ok: true, doc: ed.doc, mode: (ed.mode === 'readonly') ? 'readonly' : 'edit' };
        textEl.classList.remove('bad');
        errorEl.textContent = (ed.mode === 'readonly')
            ? 'readonly: canvas editing supports signal documents only' : '';
    };

    ed.refresh = function () {
        ed.render();
        ed.syncText();
        const cc = document.getElementById('ed-cycle-count');
        if (cc) { cc.textContent = model.cycleCount(ed.doc); }
    };

    ed.interact = interact.createInteract(ed, cfg);

    ed.openBusInput = function (row, cycle, x, y) {
        const input = document.getElementById(cfg.busInputId);
        input.hidden = false;
        input.style.left = x + 'px';
        input.style.top = y + 'px';
        input.style.width = '120px';
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
            } else if (ev.key === 'Escape') {
                done();
            }
        };
        input.onblur = done;
    };

    // row selection: clicks left of the waveform column select the row
    overlay.addEventListener('pointerdown', function (ev) {
        if (!ed.geom) { return; }
        const rect = canvas.getBoundingClientRect();
        const y = (ev.clientY - rect.top) / ed.scale;
        const row = Math.floor((y - ed.geom.y0) / ed.geom.rowHeight);
        if (ev.clientX - rect.left < ed.geom.x0 * ed.scale && row >= 0 && row < ed.doc.signal.length) {
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
        tag.textContent = (r === undefined)
            ? 'no row'
            : ('row ' + r + ((ed.doc.signal[r] && ed.doc.signal[r].name) ? ': ' + ed.doc.signal[r].name : ' (separator)'));
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
        if (ed.selectedRow !== undefined) {
            ed.selectedRow = Math.min(ed.selectedRow, ed.doc.signal.length - 1);
        }
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
            if (ev.target.value === 'default') { delete ed.doc.config; } else { ed.doc.config = { skin: ev.target.value }; }
        });
    });
    document.getElementById('ed-head').addEventListener('change', function (ev) {
        ed.op(function () {
            if (ev.target.value === '') { delete ed.doc.head; } else { ed.doc.head = { text: [ev.target.value], tick: 0 }; }
        });
    });
    document.getElementById('ed-foot').addEventListener('change', function (ev) {
        ed.op(function () {
            if (ev.target.value === '') { delete ed.doc.foot; } else { ed.doc.foot = { text: [ev.target.value], tock: 0 }; }
        });
    });

    document.getElementById('ed-undo').addEventListener('click', function () {
        const back = ed.history.undo(ed.doc);
        if (back) {
            ed.doc = back;
            ed.refresh();
            ed.renderRowButtons();
            ed.autosave();
        }
    });
    document.getElementById('ed-redo').addEventListener('click', function () {
        const fwd = ed.history.redo(ed.doc);
        if (fwd) {
            ed.doc = fwd;
            ed.refresh();
            ed.renderRowButtons();
            ed.autosave();
        }
    });

    const LS_KEY = 'easydraw.doc';

    ed.autosave = function () {
        window.clearTimeout(ed._saveTimer);
        ed._saveTimer = window.setTimeout(function () {
            try { window.localStorage.setItem(LS_KEY, model.serialize(ed.doc)); } catch { /* quota: ignore */ }
        }, 1000);
    };

    // restore on boot: fall back to starter when storage is missing/corrupt
    (function restore () {
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            if (raw) {
                const r = textsync.parseSource(raw);
                if (r.ok) {
                    if (r.mode === 'edit') {
                        const doc = model.sanitizeSignalDoc(r.doc);
                        if (doc) { ed.doc = doc; }
                    } else {
                        ed.doc = r.doc;
                        ed.mode = 'readonly';
                    }
                }
            }
        } catch { /* corrupted storage: fall back to starter */ }
        ed.refresh();
    })();

    // text panel: debounced parse, two-way
    let textTimer = null;
    textEl.addEventListener('input', function () {
        ed.textDirty = true;
        textEl.classList.add('bad');
        errorEl.textContent = '';
        window.clearTimeout(textTimer);
        textTimer = window.setTimeout(function () {
            const r = textsync.applyTextSync(textsync.parseSource(textEl.value));
            ed.textDirty = r.dirty;
            if (r.error) {
                ed.lastParse = { ok: false, error: r.error };
                textEl.classList.add('bad');
                errorEl.textContent = r.error;
                return;
            }
            ed.lastParse = { ok: true, doc: r.doc, mode: r.mode };
            ed.doc = r.doc;
            ed.mode = r.mode;
            textEl.classList.remove('bad');
            errorEl.textContent = (r.mode === 'readonly')
                ? 'readonly: canvas editing supports signal documents only' : '';
            ed.render();
            ed.autosave();
            ed.renderRowButtons();
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

    ed.renderRowButtons();

    window.ed = ed; // for console debugging and later task wiring
    return ed;
}

module.exports = boot;
if (typeof window !== 'undefined') { window.easydrawBoot = boot; }
