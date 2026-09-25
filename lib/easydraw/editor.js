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
        selectedRow: undefined,
        autosave: function () {}
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
        const cc = document.getElementById('ed-cycle-count');
        if (cc) { cc.textContent = model.cycleCount(ed.doc); }
    };

    ed.refresh();

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

    ed.renderRowButtons();

    window.ed = ed; // for console debugging and later task wiring
    return ed;
}

module.exports = boot;
if (typeof window !== 'undefined') { window.easydrawBoot = boot; }
