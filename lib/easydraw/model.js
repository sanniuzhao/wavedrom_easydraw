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

module.exports = {
    createModel: createModel,
    serialize: serialize,
    cycleCount: cycleCount,
    setCycle: setCycle,
    addSignal: addSignal,
    removeSignal: removeSignal,
    renameSignal: renameSignal,
    moveSignal: moveSignal,
    insertSeparator: insertSeparator
};
