'use strict';

const renderAny = require('../render-any.js');
const stringify = require('onml/stringify.js');
const lane = require('../lane.js');
const geometry = require('./geometry.js');
const model = require('./model.js');
const interact = require('./interact.js');

function boot (cfg) {
    const canvas = document.getElementById(cfg.canvasId);
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

    window.ed = ed; // for console debugging and later task wiring
    return ed;
}

module.exports = boot;
if (typeof window !== 'undefined') { window.easydrawBoot = boot; }
