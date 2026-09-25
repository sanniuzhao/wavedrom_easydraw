'use strict';

var textsync = require('../lib/easydraw/textsync.js');
var chai = require('chai');
var expect = chai.expect;

describe('easydraw textsync', function () {
    it('parses a valid signal document into edit mode', function () {
        var r = textsync.parseSource('{ signal: [{ name: "clk", wave: "p.." }] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('edit');
        expect(r.doc.signal[0].name).to.equal('clk');
    });
    it('parses json5 syntax (unquoted keys, trailing commas)', function () {
        var r = textsync.parseSource('{ signal: [ { name: \'a\', wave: \'p.\', }, ], }');
        expect(r.ok).to.equal(true);
    });
    it('syntax errors return ok:false with a message', function () {
        var r = textsync.parseSource('{ signal: [');
        expect(r.ok).to.equal(false);
        expect(r.error).to.be.a('string');
    });
    it('non-object roots are rejected', function () {
        expect(textsync.parseSource('[1,2,3]').ok).to.equal(false);
    });
    it('signal must be an array', function () {
        expect(textsync.parseSource('{ signal: 5 }').ok).to.equal(false);
    });
    it('assign documents parse into readonly mode', function () {
        var r = textsync.parseSource('{ assign: [ ["a", "b"] ] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('readonly');
    });
    it('reg documents parse into readonly mode', function () {
        var r = textsync.parseSource('{ reg: [] }');
        expect(r.ok).to.equal(true);
        expect(r.mode).to.equal('readonly');
    });
    it('documents without signal/assign/reg are rejected', function () {
        expect(textsync.parseSource('{ foo: 1 }').ok).to.equal(false);
    });
});

describe('easydraw textsync: editableState (Review Focus 1+2)', function () {
    it('edit mode and clean text → editable', function () {
        expect(textsync.editableState({ ok: true, mode: 'edit' }, false)).to.equal(true);
    });
    it('dirty text (user typing) blocks canvas edits', function () {
        expect(textsync.editableState({ ok: true, mode: 'edit' }, true)).to.equal(false);
    });
    it('invalid text blocks canvas edits', function () {
        expect(textsync.editableState({ ok: false, error: 'boom' }, false)).to.equal(false);
    });
    it('readonly mode blocks canvas edits', function () {
        expect(textsync.editableState({ ok: true, mode: 'readonly' }, false)).to.equal(false);
    });
});
