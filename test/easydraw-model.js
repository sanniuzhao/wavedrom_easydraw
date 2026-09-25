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
        expect(doc.signal[0].wave).to.equal('p....1');
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
