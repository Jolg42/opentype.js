// The `GSUB` table contains ligatures, among other things.
// https://www.microsoft.com/typography/OTSPEC/gsub.htm

'use strict';

var check = require('../check');
var parse = require('../parse');
var table = require('../table');

// Parse ScriptList and FeatureList tables of GPOS, GSUB, GDEF, BASE, JSTF tables.
// These lists are unused by now, this function is just the basis for a real parsing.
function parseTagListTable(data, start, callback) {
    var p = new parse.Parser(data, start);
    var n = p.parseUShort();
    var list = [];
    for (var i = 0; i < n; i++) {
        var tag = p.parseTag();
        var offset = p.parseUShort();
        list[i] = { name: tag, list: callback(data, start + offset) };
    }

    return list;
}

// Parse a coverage table in a GSUB, GPOS or GDEF table.
// Format 1 is a simple list of glyph ids,
// Format 2 is a list of ranges. It is expanded in a list of glyphs, maybe not the best idea.
function parseCoverageTable(data, start) {
    var p = new parse.Parser(data, start);
    var format = p.parseUShort();
    var count =  p.parseUShort();
    if (format === 1) {
        return p.parseUShortList(count);
    }
    else if (format === 2) {
        var coverage = [];
        for (; count--;) {
            var begin = p.parseUShort();
            var end = p.parseUShort();
            var index = p.parseUShort();
            for (var i = begin; i <= end; i++) {
                coverage[index++] = i;
            }
        }

        return coverage;
    }
}


// Parse substitution subtable, format 1 or format 2
// The subtable is returned in the form of a lookup function.
function parseGSUBLookupType1(data, start) {
    var p = new parse.Parser(data, start);
    var format = p.parseUShort();
    var coverageOffset = p.parseUShort();
    var coverage = parseCoverageTable(data, start + coverageOffset);
    var glyphsIDs = [];
    var originalGlyphID, substituteGlyphID;

    /*
     SingleSubstFormat1 subtable: Calculated output glyph indices

     Type	Name	        Description
     uint16	SubstFormat	    Format identifier-format = 1
     Offset	Coverage	    Offset to Coverage table-from beginning of Substitution table
     int16	DeltaGlyphID	Add to original GlyphID to get substitute GlyphID
     */
    if (format === 1) {
        //DeltaGlyphID is the constant value added to each input glyph index to calculate the index of the corresponding output glyph.
        var deltaGlyphID = p.parseUShort();

        for (var i = 0; i < coverage.length; i++) {
            originalGlyphID = coverage[i];
            substituteGlyphID = originalGlyphID + deltaGlyphID;

            glyphsIDs.push([originalGlyphID, substituteGlyphID]);
        }
    }
    /*
     SingleSubstFormat2 subtable: Specified output glyph indices
     Type	    Name	    Description
     uint16	    SubstFormat	Format identifier-format = 2
     Offset	    Coverage	Offset to Coverage table-from beginning of Substitution table
     uint16	    GlyphCount	Number of GlyphIDs in the Substitute array
     GlyphID	Substitute
     [GlyphCount]	        Array of substitute GlyphIDs-ordered by Coverage Index
     */
    else if(format === 2) {
        var glyphCount = p.parseUShort();

        for (var i = 0; i < glyphCount; i++) {
            originalGlyphID = coverage[i];
            substituteGlyphID = p.parseUShort();

            glyphsIDs.push([originalGlyphID, substituteGlyphID]);
        }
    }

    return glyphsIDs;
}

/*
 uint16	LigatureCount	Number of Ligature tables
 Offset	Ligature
 [LigatureCount]	Array of offsets to Ligature tables-from beginning of LigatureSet table-ordered by preference
 */
function parseGSUBLookupType4LigatureSet(data, start) {
    var p = new parse.Parser(data, start);
    var ligatureCount = p.parseUShort();
    var lig = [];

    /*
     Ligature table: Glyph components for one ligature
     Type	    Name	    Description
     GlyphID	LigGlyph	GlyphID of ligature to substitute
     uint16	    CompCount	Number of components in the ligature
     GlyphID	Component
     [CompCount - 1]	Array of component GlyphIDs-start with the second component-ordered in writing direction
     */
    // TODO Uncaught RangeError: Offset is outside the bounds of the DataView
    // start: 75511
    // last ligatureOffset: 88311
    // for fonts/LigatureSymbols-2.11.otf
    for (var i = 0; i < ligatureCount; i++) {
        var ligatureOffset = start + p.parseUShort();

        //console.log({"start": start});
        //console.log({"ligatureOffset": ligatureOffset});

        var ligGlyph = data.getUint16(ligatureOffset, false);
        ligatureOffset += 2;

        var compCount = data.getUint16(ligatureOffset, false) - 1; // The first component is taken from the coverage table.
        ligatureOffset += 2;

        var components = new Array(compCount);
        for (var j = 0; j < compCount; j++) {
            components[j] = data.getUint16(ligatureOffset, false);
            ligatureOffset += 2;
        }

        // TODO c'est vraiment pourri comme sortie
        lig.push({ glyph: ligGlyph, components: components });
    }

    //console.log({"lig": lig});

    return lig;
}

/*
 LigatureSubstFormat1 subtable: All ligature substitutions in a script
 Type	        Name	    Description
 uint16	        SubstFormat	Format identifier-format = 1
 Offset	        Coverage	Offset to Coverage table-from beginning of Substitution table
 uint16	        LigSetCount	Number of LigatureSet tables
 Offset	        LigatureSet
 [LigSetCount]	Array of offsets to LigatureSet tables-from beginning of Substitution table-ordered by Coverage Index
 */
function parseGSUBLookupType4(data, start) {
    var p = new parse.Parser(data, start);
    var substFormat = p.parseUShort();
    check.argument(substFormat === 1, 'GSUB ligature table format identifier-format must be 1');
    var coverageOffset = p.parseUShort();
    var coverage = parseCoverageTable(data, start + coverageOffset);
    var ligSetCount = p.parseUShort();
    var lig = new Array(ligSetCount);

    for (var i = 0; i < ligSetCount; i++) {
        var ligSet = lig[i] = new Array(coverage.length);
        for (var j = 0; j < coverage.length; j++) {
            ligSet[j] = parseGSUBLookupType4LigatureSet(data, start + p.parseUShort());
        }
    }

    return lig;
}

/*
 AlternateSet table
 Type	    Name	                Description
 uint16	    GlyphCount	            Number of GlyphIDs in the Alternate array
 GlyphID	Alternate[GlyphCount]	Array of alternate GlyphIDs-in arbitrary order
 */
function parseGSUBLookupType3AlternateSet(data, start) {
    var p = new parse.Parser(data, start);
    var glyphCount = p.parseUShort();

    var glyphIDs = [];
    for(var i = 0; i < glyphCount; i++) {
        glyphIDs.push(p.parseUShort());
    }

    return glyphIDs;
}

/*
 AlternateSubstFormat1 subtable: Alternative output glyphs
 Type	Name	            Description
 uint16	SubstFormat	        Format identifier-format = 1
 Offset	Coverage	        Offset to Coverage table-from beginning of Substitution table
 uint16	AlternateSetCount	Number of AlternateSet tables
 Offset	AlternateSet
 [AlternateSetCount]	    Array of offsets to AlternateSet tables-from beginning of Substitution table-ordered by Coverage Index
 */
function parseGSUBLookupType3(data, start) {
    var p = new parse.Parser(data, start);
    var substFormat = p.parseUShort();
    check.argument(substFormat === 1, 'GSUB ligature table format identifier-format must be 1');
    var coverageOffset = p.parseUShort();
    var coverage = parseCoverageTable(data, start + coverageOffset);
    var alternateSetCount = p.parseUShort();

    var alternates = [];
    for(var i = 0; i < alternateSetCount; i++) {
        alternates.push({glyphID: coverage[i], alternates: parseGSUBLookupType3AlternateSet(data, start + p.parseUShort())});
    }

    console.log({"alternates": alternates});

    return alternates;
}

/*
 Type	    Name	    Description
 uint16	    GlyphCount	Number of GlyphIDs in the Substitute array. This should always be greater than 0.
 GlyphID	Substitute
 [GlyphCount]	        String of GlyphIDs to substitute
 */
function parseGSUBLookupType2Sequence(data, start) {
    var p = new parse.Parser(data, start);
    var glyphCount = p.parseUShort();

    var glyphIDs = [];
    for(var i = 0; i < glyphCount; i++) {
        glyphIDs.push(p.parseUShort());
    }

    return glyphIDs;
}

/*
 MultipleSubstFormat1 subtable: Multiple output glyphs
 Type	Name	        Description
 uint16	SubstFormat	    Format identifier-format = 1
 Offset	Coverage	    Offset to Coverage table-from beginning of Substitution table
 uint16	SequenceCount	Number of Sequence table offsets in the Sequence array
 Offset	Sequence
 [SequenceCount]	    Array of offsets to Sequence tables-from beginning of Substitution table-ordered by Coverage Index

 */
function parseGSUBLookupType2(data, start) {
    console.log({"parseMultipleTable": 'parseMultipleTable'});
    var p = new parse.Parser(data, start);
    var substFormat = p.parseUShort();
    check.argument(substFormat === 1, 'GSUB ligature table format identifier-format must be 1');
    var coverageOffset = p.parseUShort();
    var coverage = parseCoverageTable(data, start + coverageOffset);
    var sequenceCount = p.parseUShort();

    console.log({"coverage": coverage});
    console.log({"sequenceCount": sequenceCount});

    var alternates = [];
    for(var i = 0; i < sequenceCount; i++) {
        alternates.push({glyphID: coverage[i], multiples: parseGSUBLookupType2Sequence(data, start + p.parseUShort())});
    }

    console.log({"alternates": alternates});
}

// Parse a LookupTable (present in of GPOS, GSUB, GDEF, BASE, JSTF tables).
function parseLookupTable(data, start) {
    var p = new parse.Parser(data, start);
    var lookupType = p.parseUShort();
    var lookupFlag = p.parseUShort();
    var useMarkFilteringSet = lookupFlag & 0x10;
    var subTableCount = p.parseUShort();
    var subTableOffsets = p.parseOffset16List(subTableCount);
    var table = {
        lookupType: lookupType,
        lookupFlag: lookupFlag,
        markFilteringSet: useMarkFilteringSet ? p.parseUShort() : -1
    };

    /*
     LookupType Enumeration table for glyph substitution
     Value	Type	Description
     1	Single (format 1.1 1.2)	Replace one glyph with one glyph
     2	Multiple (format 2.1)	Replace one glyph with more than one glyph
     3	Alternate (format 3.1)	Replace one glyph with one of many glyphs
     4	Ligature (format 4.1)	Replace multiple glyphs with one glyph
     5	Context (format 5.1 5.2 5.3)	Replace one or more glyphs in context
     6	Chaining Context (format 6.1 6.2 6.3)	Replace one or more glyphs in chained context
     7	Extension Substitution (format 7.1)	Extension mechanism for other substitutions (i.e. this excludes the Extension type substitution itself)
     8	Reverse chaining context single (format 8.1)	Applied in reverse order, replace single glyph in chaining context
     9+	Reserved	For future use (set to zero)
     */

    var subtableParsers = [
        null,                           // 0
        parseGSUBLookupType1,           // 1 Single (format 1.1 1.2) Replace one glyph with one glyph
        // TODO Find font with multiple to test parseMultipleTable
        //parseGSUBLookupType2,           // 2 Multiple (format 2.1)	Replace one glyph with more than one glyph
        parseGSUBLookupType3,           // 3 Alternate (format 3.1)	Replace one glyph with one of many glyphs
        // TODO Uncaught RangeError: Offset is outside the bounds of the DataView
        //parseGSUBLookupType4,           // 4 Ligature (format 4.1) Replace multiple glyphs with one glyph
        null,                           // 5
        null                            // 6
    ];

    var parsingFunction = subtableParsers[lookupType];
    if (parsingFunction) {
        var subtables = [];
        for (var i = 0; i < subTableCount; i++) {
            subtables.push(parsingFunction(data, start + subTableOffsets[i]));
        }
        table.subtables = subtables;
    }

    return table;
}


// ScriptList //////////////////////////////////////////////
// https://www.microsoft.com/typography/OTSPEC/chapter2.htm
function parseLangSysTable(data, start) {
    var p = new parse.Parser(data, start);
    var lookupOrder = p.parseUShort();                        // LookupOrder = NULL (reserved for an offset to a reordering table)
    check.argument(lookupOrder === 0, 'GSUB lookup order must be NULL.');
    var reqFeatureIndex = p.parseUShort();  // if no required features = 0xFFFF
    if (reqFeatureIndex === 0xffff) {
        reqFeatureIndex = undefined;
    }
    var featureCount = p.parseUShort();
    var featureIndex = [];
    for (var i = 0; i < featureCount; i++) {
        featureIndex.push(p.parseUShort());
    }
    return {
        reqFeatureIndex: reqFeatureIndex,
        features: featureIndex
    };
}

function parseScriptTable(data, start) {
    var p = new parse.Parser(data, start);
    var langSys = {};
    var defaultLangSysOffset = p.parseUShort();     // may be NULL
    if (defaultLangSysOffset) {
        langSys.dflt = parseLangSysTable(data, start + defaultLangSysOffset);
    }
    var langSysCount = p.parseUShort();
    for (var i = 0; i < langSysCount; i++) {
        var tag = p.parseTag();
        var offset = p.parseUShort();
        langSys[tag] = parseLangSysTable(data, start + offset);
    }

    return langSys;
}


// FeatureList //////////////////////////////////////////////
// https://www.microsoft.com/typography/OTSPEC/chapter2.htm
function parseFeatureTable(data, start) {
    var p = new parse.Parser(data, start);
    p.parseUShort();        // = NULL (reserved for offset to FeatureParams)
    var lookupCount = p.parseUShort();
    var lookupList = new Array(lookupCount);
    for (var i = 0; i < lookupCount; i++) {
        lookupList[i] = p.parseUShort();
    }
    return lookupList;
}

// https://www.microsoft.com/typography/OTSPEC/gsub.htm
function parseGsubTable(data, start) {
    var p = new parse.Parser(data, start);
    var tableVersion = p.parseFixed();
    check.argument(tableVersion === 1, 'Unsupported GSUB table version.');

    // ScriptList and FeatureList - ignored for now
    var scriptList = parseTagListTable(data, start + p.parseUShort(), parseScriptTable);
    var featureList = parseTagListTable(data, start + p.parseUShort(), parseFeatureTable);

    // Use script DFLT - langSys deflt
    var i, defaultFeatures, defaultLookups;
    for (i = 0; i < scriptList.length; i++) {
        if (scriptList[i].name === 'DFLT') {
            defaultFeatures = scriptList[i].list.dflt;
        }
    }
    if (defaultFeatures) {
        // defaultFeatures.reqFeatureIndex is ignored
        defaultLookups = [];
        var ft = defaultFeatures.features;
        for (i = 0; i < ft.length; i++) {
            defaultLookups = defaultLookups.concat(featureList[ft[i]].list);
        }
        defaultLookups.sort(function(a, b) { return a - b; });
    }
    check.argument(!!defaultLookups, 'GSUB: defaults not found.');

    // LookupList
    var lookupListOffset = p.parseUShort();
    p.relativeOffset = lookupListOffset;
    var lookupCount = p.parseUShort();
    var lookupTableOffsets = p.parseOffset16List(lookupCount);
    var lookupListAbsoluteOffset = start + lookupListOffset;
    var lookupList = [];
    for (i = 0; i < defaultLookups.length; i++) {
        var lookupListIndex = defaultLookups[i];
        var table = parseLookupTable(data, lookupListAbsoluteOffset + lookupTableOffsets[lookupListIndex]);
        lookupList.push(table);
    }

    //
    return {
        scriptList: scriptList,
        featureList: featureList,
        lookupList: lookupList,
        offset: start,
        length: p.relativeOffset,
        bytes: new Uint8Array(data.buffer.slice(start, start+p.relativeOffset))
    };
}



// GSUB Writing //////////////////////////////////////////////


function makeGsubTable(gsub) {
    // TODO améliorer sfnt.js et/ou type.js pour pas mettre directement l'hexa des tables mais leur offset et mettre les tables à la fin.
    var scriptList = new table.Table('scriptList', [
        {name: 'scriptCount', type: 'USHORT', value: 1},
        {name: 'scriptTag_0', type: 'TAG', value: 'DFLT'},
        {name: 'script_0', type: 'TABLE', value: new table.Table('scriptTable', [
            {name: 'defaultLangSys', type: 'TABLE', value: new table.Table('langSysRecord', [
                {name: 'langSysTag', type: 'TAG', value: 'dflt'},
                {name: 'langSys', type: 'TABLE',value: new table.Table('langSysTable', [
                    {name: 'lookupOrder', type: 'USHORT', value: 0},
                    {name: 'reqFeatureIndex', type: 'USHORT', value: 0xffff},
                    {name: 'featureCount', type: 'USHORT', value: 1},
                    {name: 'featureIndex_0', type: 'USHORT', value: 0}
                ])}
            ])},
            {name: 'langSysCount', type: 'USHORT', value: 0}
        ])},
    ]);

    var featureList = new table.Table('featureList', [
        {name: 'featureCount', type: 'USHORT', value: 1},
        {name: 'featureTag_0', type: 'TAG', value: 'subs'},
        {name: 'feature_0', type: 'TABLE', value: new table.Table('featureTable', [
            {name: 'featureParams', type: 'USHORT', value: 0},
            {name: 'lookupCount', type: 'USHORT', value: 1},
            {name: 'lookupListIndex_0', type: 'USHORT', value: 0}
        ])}
    ]);

    var lookupList = new table.Table('lookupList', [
        {name: 'lookupCount', type: 'USHORT', value: 1},
        {name: 'lookup_0', type: 'TABLE', value: new table.Table('lookupTable', [
            {name: 'lookupType', type: 'USHORT', value: 1}, // TYPE 1
            {name: 'lookupFlag', type: 'USHORT', value: 0},
            {name: 'subtableCount', type: 'USHORT', value: 1},
            {name: 'subtable_0', type: 'TABLE', value: new table.Table('substitutionTable', [
                {name: 'substFormat', type: 'USHORT', value: 1},            // Single substitution format 1
                {name: 'coverage', type: 'TABLE', value: new table.Table('coverageTable', [
                    {name: 'coverageFormat', type: 'USHORT', value: 1},
                    {name: 'glyphCount', type: 'USHORT', value: 1},
                    {name: 'glyphID_0', type: 'USHORT', value: 6}       // le glyph 6 va être remplacé...
                ])},
                {name: 'deltaGlyphID', type: 'USHORT', value: 9 - 6}    // ...par le 9
            ])}
        ])},
    ]);

    var gsubTable = new table.Table('GSUB', [
        {name: 'version', type: 'ULONG', value: 0x10000},
        {name: 'scriptList', type: 'TABLE', value: scriptList},
        {name: 'featureList', type: 'TABLE', value: featureList},
        {name: 'lookupList', type: 'TABLE', value: lookupList}
    ]);

    console.log('making gsub table');

    return gsubTable;
}

exports.parse = parseGsubTable;
exports.make = makeGsubTable;