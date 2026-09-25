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
