#!/usr/bin/env node
/* =====================================================================
 * run.js — score the matcher against eval/corpus.js.
 *
 *   npm run eval            full report
 *   npm run eval -- --miss  only the failures
 *   npm run eval -- --json  machine-readable summary
 *
 * Every threshold and blend weight in the engine should be justified by a
 * number from here, not by how a handful of hand-typed questions felt.
 * ===================================================================== */
'use strict';

const NLU = require('../public/chat/nlu.js');
const KNOWLEDGE = require('../public/chat/knowledge.js');
const CORPUS = require('./corpus.js');

const NOW = '2026-08-05T12:00:00';          // fixed clock: dates must not drift the score
const args = process.argv.slice(2);
const onlyMisses = args.includes('--miss');
const asJson = args.includes('--json');

const engine = new NLU.Engine({ concepts: KNOWLEDGE.CONCEPTS });
engine.addAll(KNOWLEDGE.INTENTS).train();

/* ---------------- run ---------------- */

const rows = CORPUS.map(item => {
    const r = engine.match(item.text, {}, NOW);
    // Anything the engine is not confident about counts as "no answer".
    const predicted = r.status === 'confident' && r.intent ? r.intent.id : null;
    return {
        text: item.text,
        expected: item.intent,
        predicted,
        confidence: r.confidence,
        status: r.status,
        correct: predicted === item.intent
    };
});

/* ---------------- per-intent precision / recall ---------------- */

const labels = [...new Set(CORPUS.map(c => c.intent).filter(Boolean))].sort();
const stats = {};
labels.forEach(l => (stats[l] = { tp: 0, fp: 0, fn: 0, support: 0 }));

rows.forEach(row => {
    if (row.expected) stats[row.expected].support++;
    if (row.predicted && row.expected === row.predicted) stats[row.predicted].tp++;
    else {
        if (row.predicted && stats[row.predicted]) stats[row.predicted].fp++;
        if (row.expected) stats[row.expected].fn++;
    }
});

const positives = rows.filter(r => r.expected);
const negatives = rows.filter(r => !r.expected);

const accuracy = positives.filter(r => r.correct).length / positives.length;
const missRate = positives.filter(r => !r.predicted).length / positives.length;      // shrugged at a real question
const wrongRate = positives.filter(r => r.predicted && !r.correct).length / positives.length;
const falseConfidence = negatives.filter(r => r.predicted).length / (negatives.length || 1);

const macroF1 = labels.reduce((sum, l) => {
    const s = stats[l];
    const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 0;
    const rc = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 0;
    return sum + (p + rc ? (2 * p * rc) / (p + rc) : 0);
}, 0) / labels.length;

/* ---------------- output ---------------- */

if (asJson) {
    console.log(JSON.stringify({
        accuracy, missRate, wrongRate, falseConfidence, macroF1,
        positives: positives.length, negatives: negatives.length
    }, null, 2));
    process.exit(0);
}

const pct = n => (n * 100).toFixed(1).padStart(5) + '%';

if (!onlyMisses) {
    console.log('\nPER-INTENT');
    console.log('intent'.padEnd(16) + 'prec'.padStart(7) + 'recall'.padStart(8) +
        'f1'.padStart(7) + 'n'.padStart(4));
    console.log('-'.repeat(42));
    labels.forEach(l => {
        const s = stats[l];
        const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 0;
        const rc = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 0;
        const f1 = p + rc ? (2 * p * rc) / (p + rc) : 0;
        const flag = f1 < 0.7 ? '  <-- weak' : '';
        console.log(l.padEnd(16) + pct(p) + pct(rc) + pct(f1) +
            String(s.support).padStart(4) + flag);
    });
}

const misses = rows.filter(r => !r.correct);
if (misses.length) {
    console.log('\nMISSES (' + misses.length + ')');
    misses.forEach(m => {
        console.log('  ' + (m.expected || '(none)').padEnd(14) + '-> ' +
            (m.predicted || '(none)').padEnd(14) +
            m.confidence.toFixed(2).padStart(5) + '  "' + m.text + '"');
    });
}

// Confusion matrix, sparse: only pairs that actually collide.
const pairs = {};
misses.filter(m => m.expected && m.predicted).forEach(m => {
    const k = m.expected + ' -> ' + m.predicted;
    pairs[k] = (pairs[k] || 0) + 1;
});
const confused = Object.entries(pairs).sort((a, b) => b[1] - a[1]);
if (confused.length) {
    console.log('\nCONFUSION (expected -> predicted)');
    confused.forEach(([k, n]) => console.log('  ' + String(n).padStart(3) + '  ' + k));
}

console.log('\nSUMMARY');
console.log('  accuracy         ' + pct(accuracy) + '   (' + positives.length + ' labelled)');
console.log('  missed           ' + pct(missRate) + '   real question, no confident answer');
console.log('  wrong            ' + pct(wrongRate) + '   confident but the wrong intent');
console.log('  false confidence ' + pct(falseConfidence) + '   answered ' +
    negatives.length + ' out-of-domain inputs it should have declined');
console.log('  macro F1         ' + pct(macroF1));
console.log('  thresholds       answer=' + engine.thresholds.answer +
    ' hedge=' + engine.thresholds.hedge + '\n');

process.exit(0);
