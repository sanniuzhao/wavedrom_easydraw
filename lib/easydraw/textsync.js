'use strict';

const json5 = require('json5');
const model = require('./model.js');

function parseSource (text) {
    let doc;
    try {
        doc = json5.parse(text);
    } catch (e) {
        return { ok: false, error: e.message };
    }
    if (Object.prototype.toString.call(doc) !== '[object Object]') {
        return { ok: false, error: 'the root has to be an object: "{signal:[...]}"' };
    }
    if (doc.signal !== undefined) {
        if (!Array.isArray(doc.signal)) {
            return { ok: false, error: '"signal" has to be an array: "signal:[]"' };
        }
        if (doc.signal.some(function (s) { return Array.isArray(s); })) {
            return { ok: true, doc: doc, mode: 'readonly' };
        }
        return { ok: true, doc: doc, mode: 'edit' };
    }
    if (doc.assign !== undefined) {
        if (!Array.isArray(doc.assign)) {
            return { ok: false, error: '"assign" has to be an array: "assign:[]"' };
        }
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    if (doc.reg !== undefined) {
        if (!Array.isArray(doc.reg)) {
            return { ok: false, error: '"reg" has to be an array: "reg:[]"' };
        }
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    return { ok: false, error: '"signal:[...]", "assign:[...]" or "reg" property is missing' };
}

function applyTextSync (r) {
    if (!r.ok) {
        return { dirty: true, error: r.error };
    }
    if (r.mode === 'edit') {
        const doc = model.sanitizeSignalDoc(r.doc);
        if (!doc) {
            return { dirty: true, error: 'invalid signal document: needs a non-empty "signal" array of objects' };
        }
        return { dirty: false, doc: doc, mode: 'edit' };
    }
    return { dirty: false, doc: r.doc, mode: 'readonly' };
}

function editableState (lastParse, textDirty) {
    return Boolean(lastParse && lastParse.ok && lastParse.mode === 'edit' && !textDirty);
}

module.exports = {
    parseSource: parseSource,
    applyTextSync: applyTextSync,
    editableState: editableState
};
