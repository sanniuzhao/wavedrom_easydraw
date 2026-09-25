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
        cycleWidth: 2 * lane.xs * (lane.hscale || 1),
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
