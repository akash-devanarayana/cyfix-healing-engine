const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = 3000;

const fingerprintStore = new Map();

// Middleware to parse JSON bodies from incoming requests
app.use(express.json({limit: '50mb'})); // Increase limit to handle large DOMs

app.get('/', (req, res) => {
    res.status(200).send('Server is up and running!');
})

// --- Endpoint to Learn a Fingerprint ---
app.post('/learn', (req, res) => {
    const {selector, fingerprint} = req.body;

    if (!selector || !fingerprint) {
        return res.status(400).send({message: 'Both selector and fingerprint are required.'});
    }

    fingerprintStore.set(selector, fingerprint);
    console.log(`🧠 Learned fingerprint for: ${selector}`);
    res.status(200).send({message: 'Learned successfully.'});
});

// --- Endpoint to Heal a Broken Selector ---
app.post('/heal', (req, res) => {
    const {brokenSelector, domSnapshot} = req.body;
    const storedFingerprint = fingerprintStore.get(brokenSelector);

    if (!storedFingerprint) {
        return res.status(404).send({message: 'No fingerprint found.'});
    }

    const $ = cheerio.load(domSnapshot);
    let topCandidates = [];
    let topScore = 0;
    let bestCandidate = {element: null, score: 0};

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

        // --- Logic to Handle Ties ---
        if (currentScore > topScore) {
            topScore = currentScore;
            topCandidates = [element];
        } else if (currentScore > 0 && currentScore === topScore) {
            topCandidates.push(element);
        }
    });

    // --- Check for Ambiguity ---
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
        return res.status(409).send({message: `Healing failed due to ambiguity. Found ${topCandidates.length} matching elements.`}); // 409 Conflict
    }

    console.log(`Heal failed: No element matched fingerprint for "${brokenSelector}" (highest score: ${bestCandidate.score})`);
    return res.status(404).send({message: 'Healing failed. No element strongly matched fingerprint.'});
});

app.listen(PORT, () => {
    console.log(`Healing server running at http://localhost:${PORT}`);
});