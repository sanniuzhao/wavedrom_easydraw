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

describe('easydraw model: row management', function () {
    it('addSignal inserts a padded row after the given index', function () {
        var doc = { signal: [{ name: 'a', wave: 'p...' }] };
        model.addSignal(doc, 0);
        expect(doc.signal.length).to.equal(2);
        expect(doc.signal[1].wave).to.equal('....');
        expect(doc.signal[1].name).to.equal('sig');
    });
    it('addSignal makes names unique', function () {
        var doc = { signal: [{ name: 'sig', wave: 'p' }, { name: 'sig2', wave: 'p' }] };
        model.addSignal(doc, 1);
        expect(doc.signal[2].name).to.equal('sig3');
    });
    it('removeSignal refuses to empty the signal list', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        expect(model.removeSignal(doc, 0)).to.equal(false);
        expect(doc.signal.length).to.equal(1);
    });
    it('removeSignal removes and returns true', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }, { name: 'b', wave: 'p' }] };
        expect(model.removeSignal(doc, 0)).to.equal(true);
        expect(doc.signal[0].name).to.equal('b');
    });
    it('renameSignal updates the name', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        expect(model.renameSignal(doc, 0, 'clk2x')).to.equal(true);
        expect(doc.signal[0].name).to.equal('clk2x');
        expect(model.renameSignal(doc, 9, 'x')).to.equal(false);
    });
    it('moveSignal reorders rows', function () {
        var doc = { signal: [{ name: 'a' }, {}, { name: 'b' }] };
        expect(model.moveSignal(doc, 2, 0)).to.equal(true);
        expect(doc.signal[0].name).to.equal('b');
        expect(doc.signal[1]).to.deep.equal({ name: 'a' });
        expect(doc.signal[2]).to.deep.equal({});
    });
    it('insertSeparator adds an empty row', function () {
        var doc = { signal: [{ name: 'a', wave: 'p' }] };
        model.insertSeparator(doc, 0);
        expect(doc.signal[1]).to.deep.equal({});
    });
});
