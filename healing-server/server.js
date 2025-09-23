const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const fingerprintStore = new Map();

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
            const safeFilename = selector.replace(/[^a-zA-Z0-9]/g, '_') + '.html';
            const snapshotPath = path.join(__dirname, 'snapshots', safeFilename);
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

    // Use the Map's .get() method
    const storedFingerprint = fingerprintStore.get(brokenSelector);

    if (!storedFingerprint) {
        return res.status(404).send({message: 'No fingerprint found.'});
    }

    // The rest of the healing logic remains exactly the same
    const $ = cheerio.load(domSnapshot);
    let topCandidates = [];
    let topScore = 0;
    $('*').each((index, element) => {
        let currentScore = 0;
        const $el = $(element);
        if (storedFingerprint.tagName === $el.prop('tagName')) {
            currentScore += 1;
        }
        if (storedFingerprint.innerText && storedFingerprint.innerText === $el.text().trim()) {
            currentScore += 5;
        }
        if (storedFingerprint.className && storedFingerprint.className === $el.attr('class')) {
            currentScore += 3;
        }
        if (storedFingerprint.placeholder && storedFingerprint.placeholder === $el.attr('placeholder')) {
            currentScore += 2;
        }
        if (storedFingerprint.type && storedFingerprint.type === $el.attr('type')) {
            currentScore += 2;
        }
        if (storedFingerprint['aria-label'] && storedFingerprint['aria-label'] === $el.attr('aria-label')) {
            currentScore += 4;
        }
        if (currentScore > topScore) {
            topScore = currentScore;
            topCandidates = [element];
        } else if (currentScore > 0 && currentScore === topScore) {
            topCandidates.push(element);
        }
    });

    if (topScore > 5 && topCandidates.length === 1) {
        const bestCandidate = topCandidates[0];
        const newId = $(bestCandidate).attr('id');
        if (newId) {
            const healedSelector = `#${newId}`;
            console.log(`✨ Healed "${brokenSelector}" -> "${healedSelector}" with score: ${topScore}`);
            return res.status(200).send({healedSelector: healedSelector});
        }
    }
    if (topCandidates.length > 1) {
        console.log(`Heal failed: Ambiguous match. Found ${topCandidates.length} elements with score ${topScore} for "${brokenSelector}"`);
        return res.status(409).send({message: `Healing failed due to ambiguity. Found ${topCandidates.length} matching elements.`});
    }
    console.log(`Heal failed: No element matched fingerprint for "${brokenSelector}" (highest score: ${topScore})`);
    return res.status(404).send({message: 'Healing failed. No element strongly matched fingerprint.'});
});

app.listen(PORT, () => {
    console.log(`Healing server running at http://localhost:${PORT}`);
});