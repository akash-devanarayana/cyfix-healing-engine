const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const fingerprintStore = new Map();

// Healing confidence threshold (default: 80%)
const HEAL_THRESHOLD = process.env.HEAL_THRESHOLD
    ? parseFloat(process.env.HEAL_THRESHOLD)
    : 80;

app.use(express.json({limit: '50mb'}));

// --- Endpoint to Learn a Fingerprint ---
app.post('/learn', (req, res) => {
    const {selector, fingerprint, domSnapshot} = req.body;
    if (!selector || !fingerprint) {
        return res.status(400).send({message: 'Selector and fingerprint are required.'});
    }

    fingerprintStore.set(selector, fingerprint);
    console.log(`🧠 Learned (in-memory) fingerprint for: ${selector}`);

    if (domSnapshot) {
        try {
            // ensure snapshots directory exists
            const snapshotDir = path.join(__dirname, 'snapshots');
            fs.mkdirSync(snapshotDir, {recursive: true});

            const safeFilename = selector.replace(/[^a-zA-Z0-9]/g, '_') + '.html';
            const snapshotPath = path.join(snapshotDir, safeFilename);
            fs.writeFileSync(snapshotPath, domSnapshot);
            console.log(`Saved HTML snapshot to: ${safeFilename}`);
        } catch (err) {
            console.error('Error saving snapshot:', err);
        }
    }

    res.status(200).send({message: 'Learned successfully.'});
});

// --- Endpoint to Heal a Broken Selector ---
app.post('/heal', (req, res) => {
    const {brokenSelector, domSnapshot} = req.body;

    // Lookup stored fingerprint
    const storedFingerprint = fingerprintStore.get(brokenSelector);
    if (!storedFingerprint) {
        return res.status(404).send({
            message: 'No fingerprint found.',
            confidence: 0
        });
    }

    const $ = cheerio.load(domSnapshot);

    let topCandidates = [];
    let topScore = 0;

    // ---- Helper functions ----
    function stringSimilarity(a, b) {
        if (!a || !b) return 0;
        a = a.toLowerCase();
        b = b.toLowerCase();

        const matrix = Array.from({length: a.length + 1}, () => []);
        for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
        for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        const distance = matrix[a.length][b.length];
        const maxLen = Math.max(a.length, b.length);
        return 1 - distance / maxLen;
    }

    function classOverlapScore(fpClass, elClass) {
        if (!fpClass || !elClass) return 0;
        const fpSet = new Set(fpClass.split(/\s+/));
        const elSet = new Set(elClass.split(/\s+/));
        let common = 0;
        fpSet.forEach(cls => {
            if (elSet.has(cls)) common++;
        });
        return common / fpSet.size;
    }

    // ---- Scoring loop ----
    $('*').each((index, element) => {
        let currentScore = 0;
        let maxPossibleScore = 0;
        const $el = $(element);

        // Tag name (1 point)
        if (storedFingerprint.tagName) {
            maxPossibleScore += 1;
            if (storedFingerprint.tagName === $el.prop('tagName')) {
                currentScore += 1;
            }
        }

        // Inner text (5 points, fuzzy)
        if (storedFingerprint.innerText) {
            maxPossibleScore += 5;
            const sim = stringSimilarity(storedFingerprint.innerText, $el.text().trim());
            currentScore += sim * 5;
        }

        // Class overlap (3 points, fuzzy)
        if (storedFingerprint.className) {
            maxPossibleScore += 3;
            const overlap = classOverlapScore(storedFingerprint.className, $el.attr('class'));
            currentScore += overlap * 3;
        }

        // Placeholder (2 points, fuzzy)
        if (storedFingerprint.placeholder) {
            maxPossibleScore += 2;
            const sim = stringSimilarity(storedFingerprint.placeholder, $el.attr('placeholder'));
            currentScore += sim * 2;
        }

        // Type (2 points, exact)
        if (storedFingerprint.type) {
            maxPossibleScore += 2;
            if (storedFingerprint.type === $el.attr('type')) {
                currentScore += 2;
            }
        }

        // Aria-label (4 points, fuzzy)
        if (storedFingerprint['aria-label']) {
            maxPossibleScore += 4;
            const sim = stringSimilarity(storedFingerprint['aria-label'], $el.attr('aria-label'));
            currentScore += sim * 4;
        }

        // Normalize score into confidence %
        const confidence = maxPossibleScore > 0
            ? (currentScore / maxPossibleScore) * 100
            : 0;

        // Track best candidate(s)
        if (confidence > topScore) {
            topScore = confidence;
            topCandidates = [element];
        } else if (confidence > 0 && confidence === topScore) {
            topCandidates.push(element);
        }
    });

    // ---- Decision logic ----
    if (topScore >= HEAL_THRESHOLD && topCandidates.length === 1) {
        const bestCandidate = topCandidates[0];

        // Fallback strategies for healed selector
        const newId = $(bestCandidate).attr('id');
        if (newId) {
            const healedSelector = `#${newId}`;
            console.log(`✨ Healed "${brokenSelector}" -> "${healedSelector}" with confidence: ${topScore.toFixed(1)}%`);
            return res.status(200).send({healedSelector, confidence: topScore.toFixed(1)});
        }

        const ariaLabel = $(bestCandidate).attr('aria-label');
        if (ariaLabel) {
            const healedSelector = `[aria-label="${ariaLabel}"]`;
            console.log(`✨ Healed using aria-label: "${brokenSelector}" -> "${healedSelector}" with confidence: ${topScore.toFixed(1)}%`);
            return res.status(200).send({healedSelector, confidence: topScore.toFixed(1)});
        }

        const className = $(bestCandidate).attr('class');
        if (className) {
            const tagName = bestCandidate.tagName.toLowerCase();
            const healedSelector = `${tagName}.${className.split(' ').join('.')}`;
            console.log(`✨ Healed using class: "${brokenSelector}" -> "${healedSelector}" with confidence: ${topScore.toFixed(1)}%`);
            return res.status(200).send({healedSelector, confidence: topScore.toFixed(1)});
        }

        // Last resort: nth-of-type
        const tagName = bestCandidate.tagName.toLowerCase();
        const parent = bestCandidate.parent;
        const siblings = $(parent).children(tagName);
        const index = siblings.index(bestCandidate) + 1;
        if (index > 0) {
            const healedSelector = `${tagName}:nth-of-type(${index})`;
            console.log(`✨ Healed using nth-of-type: "${brokenSelector}" -> "${healedSelector}" with confidence: ${topScore.toFixed(1)}%`);
            return res.status(200).send({healedSelector, confidence: topScore.toFixed(1)});
        }
    }

    if (topCandidates.length > 1) {
        console.log(`⚠️ Heal failed: Ambiguous match. Found ${topCandidates.length} elements at ~${topScore.toFixed(1)}% confidence for "${brokenSelector}"`);
        return res.status(409).send({
            message: `Healing failed due to ambiguity. Found ${topCandidates.length} matching elements.`,
            confidence: topScore.toFixed(1)
        });
    }

    console.log(`❌ Heal failed: No strong match for "${brokenSelector}" (highest confidence: ${topScore.toFixed(1)}%)`);
    return res.status(404).send({
        message: 'Healing failed. No element strongly matched fingerprint.',
        confidence: topScore.toFixed(1)
    });
});

app.listen(PORT, () => {
    console.log(`Healing server running at http://localhost:${PORT}`);
});
