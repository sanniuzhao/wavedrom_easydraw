'use strict';

const json5 = require('json5');

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
        return { ok: true, doc: doc, mode: 'edit' };
    }
    if (doc.assign !== undefined) {
        if (!Array.isArray(doc.assign)) {
            return { ok: false, error: '"assign" has to be an array: "assign:[]"' };
        }
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    if (doc.reg !== undefined) {
        return { ok: true, doc: doc, mode: 'readonly' };
    }
    return { ok: false, error: '"signal:[...]", "assign:[...]" or "reg" property is missing' };
}

function editableState (lastParse, textDirty) {
    return Boolean(lastParse && lastParse.ok && lastParse.mode === 'edit' && !textDirty);
}

module.exports = {
    parseSource: parseSource,
    editableState: editableState
};
