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

module.exports = {
    createModel: createModel,
    serialize: serialize,
    cycleCount: cycleCount,
    setCycle: setCycle,
    addSignal: addSignal,
    removeSignal: removeSignal,
    renameSignal: renameSignal,
    moveSignal: moveSignal,
    insertSeparator: insertSeparator,
    dataSlots: dataSlots,
    setBusValue: setBusValue,
    resizeCycles: resizeCycles,
    createHistory: createHistory,
    sanitizeSignalDoc: sanitizeSignalDoc
};
