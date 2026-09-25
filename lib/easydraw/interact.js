'use strict';

const geometry = require('./geometry.js');
const textsync = require('./textsync.js');
const model = require('./model.js');

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
    let strokeCommitted = false;

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
        if (tool === '=') {
            ed.openBusInput(
                hit.row,
                hit.cycle,
                (ed.geom.x0 + hit.cycle * ed.geom.cycleWidth) * ed.scale,
                (ed.geom.y0 + hit.row * ed.geom.rowHeight) * ed.scale
            );
            return;
        }
        if (!strokeCommitted) {
            ed.history.commit(ed.doc);
            strokeCommitted = true;
        }
        model.setCycle(ed.doc, hit.row, hit.cycle, tool);
        ed.refresh();
        ed.autosave();
    }

    overlay.addEventListener('pointerdown', function (ev) {
        if (!canEdit()) { return; }
        painting = true;
        strokeCommitted = false;
        overlay.setPointerCapture(ev.pointerId);
        applyAt(ev);
    });
    overlay.addEventListener('pointermove', function (ev) {
        const p = toSvg(ev);
        const hit = (ed.geom) ? geometry.hitTest(ed.geom, p.x, p.y) : null;
        if (hit && hit.row < ed.doc.signal.length && canEdit()) {
            const s = ed.scale;
            hover.style.display = 'block';
            hover.style.left = ((ed.geom.x0 + hit.cycle * ed.geom.cycleWidth) * s) + 'px';
            hover.style.top = ((ed.geom.y0 + hit.row * ed.geom.rowHeight) * s) + 'px';
            hover.style.width = (ed.geom.cycleWidth * s) + 'px';
            hover.style.height = (ed.geom.rowHeight * s) + 'px';
        } else {
            hover.style.display = 'none';
        }
        if (painting && tool !== '=') { applyAt(ev); }
    });
    overlay.addEventListener('pointerup', function () { painting = false; });

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

module.exports = {
    createInteract: createInteract,
    TOOLS: TOOLS
};
