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
    it('hscale widens cycle width and hit-testing follows (review fix 5)', function () {
        var g = geometry.extractGeometry(render({ config: { hscale: 2 }, signal: [{ name: 'clk', wave: 'p.......' }] }), lane);
        expect(g.cycleWidth).to.equal(2 * lane.xs * 2);
        expect(geometry.hitTest(g, g.x0 + 2 * g.cycleWidth + 5, g.y0 + 15)).to.deep.equal({ row: 0, cycle: 2 });
    });
});
