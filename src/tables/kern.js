// The `kern` table contains kerning pairs.
// Note that some fonts use the GPOS OpenType layout table to specify kerning.
// https://www.microsoft.com/typography/OTSPEC/kern.htm
// https://developer.apple.com/fonts/TrueType-Reference-Manual/RM06/Chap6kern.html

'use strict';

var check = require('../check');
var parse = require('../parse');
var table = require('../table');

function parseWindowsKernTable(p) {
    var pairs = {};

    // Skip nTables.
    p.skip('uShort');
    // var nTables = p.parseUShort();

    var subtableVersion = p.parseUShort();
    check.argument(subtableVersion === 0, 'Unsupported kern sub-table version: ' + subtableVersion);

    // Skip subtableLength, subtableCoverage
    p.skip('uShort', 2);
    // var subtableLength = p.parseUShort();
    // var subtableCoverage = p.parseUShort();

    var nPairs = p.parseUShort();

    // Skip searchRange, entrySelector, rangeShift.
    p.skip('uShort', 3);
    // var searchRange = p.parseUShort();
    // var entrySelector = p.parseUShort();
    // var rangeShift = p.parseUShort();

    for (var i = 0; i < nPairs; i += 1) {
        var leftIndex = p.parseUShort();
        var rightIndex = p.parseUShort();
        var value = p.parseShort();
        pairs[leftIndex + ',' + rightIndex] = value;
    }

    return pairs;
}

function makeKernTable(pairs) {
    var keys = Object.keys(pairs);

    var t = new table.Table('kern', [
        {name: 'version', type: 'ULONG', value: 0},
        {name: 'nTables', type: 'USHORT', value: 0},
        {name: 'subtableLength', type: 'USHORT', value:  7 * 2 + keys.length * 3 * 2},
        // Hex 0xA000 = Binary 1010000000000000
        {name: 'subtableCoverage', type: 'USHORT', value: 8 >> 0x0101},
        {name: 'nPairs', type: 'USHORT', value: keys.length},
        {name: 'searchRange', type: 'USHORT', value: 0},
        {name: 'entrySelector', type: 'USHORT', value: 0},
        {name: 'rangeShift', type: 'USHORT', value: 0}
    ]);

    t.searchRange = Math.pow(2, Math.floor(Math.log(keys.length) / Math.log(2))) * 2 * 3;
    t.entrySelector = Math.log(t.searchRange / (2 * 3)) / Math.log(2);
    t.rangeShift = keys.length * 2 * 3 - t.searchRange;

    for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var keyString = key.replace(',', '_');
        var split = key.split(',');
        var leftIndex = parseInt(split[0]);
        var rightIndex = parseInt(split[1]);
        var value = pairs[key];

        t.fields.push({name: 'pair_left_' + keyString, type: 'USHORT', value: leftIndex});
        t.fields.push({name: 'pair_right_' + keyString, type: 'USHORT', value: rightIndex});
        t.fields.push({name: 'pair_value_' + keyString, type: 'SHORT', value: value});
    }

    return t;
}

function parseMacKernTable(p) {
    var pairs = {};
    // The Mac kern table stores the version as a fixed (32 bits) but we only loaded the first 16 bits.
    // Skip the rest.
    // p.skip('uShort');
    var nTables = p.parseULong();
    check.argument(nTables === 1, 'Only 1 subtable is supported (got ' + nTables + ').');
    if (nTables > 1) {
        console.warn('Only the first kern subtable is supported.');
    }
    p.skip('uLong');
    var coverage = p.parseUShort();
    var subtableVersion = coverage & 0xFF;
    p.skip('uShort');
    if (subtableVersion === 0) {
        var nPairs = p.parseUShort();
        // Skip searchRange, entrySelector, rangeShift.
        p.skip('uShort', 3);
        for (var i = 0; i < nPairs; i += 1) {
            var leftIndex = p.parseUShort();
            var rightIndex = p.parseUShort();
            var value = p.parseShort();
            pairs[leftIndex + ',' + rightIndex] = value;
        }
    }
    return pairs;
}

// Parse the `kern` table which contains kerning pairs.
function parseKernTable(data, start) {
    var p = new parse.Parser(data, start);
    var tableVersion = p.parseUShort();

    if (tableVersion === 0) {
        return parseWindowsKernTable(p);
    } else if (tableVersion === 1) {
        return parseMacKernTable(p);
    } else {
        throw new Error('Unsupported kern table version (' + tableVersion + ').');
    }
}

exports.parse = parseKernTable;
exports.make = makeKernTable;
