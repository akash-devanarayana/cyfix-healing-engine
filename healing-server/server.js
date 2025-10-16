const express = require("express");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { getLogger } = require("./utils/logger.js");

// ---- Logger Initialization ----
const logger = getLogger({ level: 'info' });

const app = express();
const PORT = process.env.PORT || 3000;
const HEAL_THRESHOLD = process.env.HEAL_THRESHOLD
    ? parseFloat(process.env.HEAL_THRESHOLD)
    : 80; // %

// ---- Utils ----
app.use(express.json({ limit: "50mb" }));

const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

function fileKeyFromPageKey(pageKey) {
    // pageKey e.g. "localhost_/healing-page.html"
    return pageKey.replace(/[^\w\-]+/g, "_");
}

function loadSnapshots(pageKey) {
    const file = path.join(SNAPSHOTS_DIR, fileKeyFromPageKey(pageKey) + ".json");
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        logger.error("Failed to parse snapshot file", { file, error: err.message });
        return {};
    }
}

function saveSnapshots(pageKey, data) {
    const snapshotDir = path.join(__dirname, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });
    const file = path.join(SNAPSHOTS_DIR, fileKeyFromPageKey(pageKey) + ".json");
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    logger.debug("Snapshots saved successfully", { pageKey });
}

function nowISO() {
    return new Date().toISOString();
}

// ---- similarity helpers (0..1) ----
function jaccardSetSimilarity(aStr = "", bStr = "") {
    const A = new Set(aStr.trim().split(/\s+/).filter(Boolean));
    const B = new Set(bStr.trim().split(/\s+/).filter(Boolean));
    if (!A.size && !B.size) return 1;
    const inter = new Set([...A].filter(x => B.has(x))).size;
    const union = new Set([...A, ...B]).size;
    return union ? inter / union : 0;
}

function textSimilarity(a = "", b = "") {
    // lightweight: exact -> 1, includes -> 0.8, token overlap -> jaccard, else 0
    const A = a.trim(), B = b.trim();
    if (!A && !B) return 1;
    if (A === B) return 1;
    if (A && B && (A.includes(B) || B.includes(A))) return 0.8;
    return jaccardSetSimilarity(A.toLowerCase(), B.toLowerCase());
}

function scoreCandidate(fp, cand) {
    // weights sum to 100
    const tagScore = fp.tagName && cand.tagName &&
    fp.tagName.toUpperCase() === cand.tagName.toUpperCase() ? 50 : 0;
    const classScore = 30 * jaccardSetSimilarity(fp.className, cand.className);
    const textScore = 20 * textSimilarity(fp.innerText, cand.innerText);
    return Math.round((tagScore + classScore + textScore) * 10) / 10;
}

// ========== API ==========
app.post("/learn", (req, res) => {
    try {
        let { pageKey, id, tagName, className = "", innerText = "" } = req.body || {};

        const normId = s => String(s || "").replace(/^#/, "").trim();
        pageKey = normId(pageKey);
        id = normId(id);
        tagName = String(tagName || "").trim();

        if (!pageKey || !id || !tagName) {
            logger.warn("[/learn] Bad request: Missing required parameters", { body: req.body });
            return res.status(400).send({ message: "pageKey, id, tagName are required" });
        }

        const now = new Date().toISOString();
        const store = loadSnapshots(pageKey);

        // --- Logic for finding and merging element families ---
        const histIndex = new Map();
        const getSet = k => (histIndex.has(k) ? histIndex.get(k) : histIndex.set(k, new Set()).get(k));
        for (const [k, rec] of Object.entries(store)) {
            const hist = Array.isArray(rec.history) ? rec.history.map(normId) : [];
            for (const h of hist) getSet(h).add(k);
        }
        const familyKeys = new Set();
        const queue = [];
        for (const k of (histIndex.get(id) || [])) {
            if (!familyKeys.has(k)) {
                familyKeys.add(k);
                queue.push(k);
            }
        }
        if (store[id]) {
            familyKeys.add(id);
            queue.push(id);
        }
        while (queue.length) {
            const curKey = queue.shift();
            const rec = store[curKey];
            const curHist = Array.isArray(rec?.history) ? rec.history.map(normId) : [];
            for (const h of curHist) {
                const neighbors = histIndex.get(h);
                if (!neighbors) continue;
                for (const nKey of neighbors) {
                    if (!familyKeys.has(nKey)) {
                        familyKeys.add(nKey);
                        queue.push(nKey);
                    }
                }
            }
        }
        const mergedHistory = new Set();
        for (const k of familyKeys) {
            const rec = store[k] || {};
            const hist = Array.isArray(rec.history) ? rec.history.map(normId) : [];
            for (const h of hist) mergedHistory.add(h);
            mergedHistory.add(normId(k));
        }
        if (store[id]?.history) {
            for (const h of store[id].history.map(normId)) mergedHistory.add(h);
        }
        mergedHistory.delete(id);
        // --- End of merging logic ---

        store[id] = {
            id,
            tagName,
            className,
            innerText,
            lastSeen: now,
            history: Array.from(mergedHistory),
        };

        for (const k of familyKeys) {
            if (k !== id) delete store[k];
        }

        saveSnapshots(pageKey, store);

        const message = familyKeys.size ? "Snapshot stored (merged family)" : "Snapshot stored";
        logger.info(`[/learn] ${message}`, { pageKey, id, mergedCount: familyKeys.size });

        return res.send({ message, stored: store[id] });

    } catch (err) {
        logger.error("[/learn] Internal server error", { error: err.stack });
        return res.status(500).send({ message: "Internal error in /learn" });
    }
});

app.post("/heal", (req, res) => {
    const { pageKey, brokenId, domSnapshot } = req.body || {};
    if (!pageKey || !brokenId || !domSnapshot) {
        logger.warn("[/heal] Bad request: Missing required parameters", { body: req.body });
        return res.status(400).send({ message: "pageKey, brokenId, domSnapshot required" });
    }

    const store = loadSnapshots(pageKey);

    // 1. Try direct match
    let fp = store[brokenId];
    let foundKey = brokenId;

    // 2. If not found, search in history arrays
    if (!fp) {
        for (const [id, data] of Object.entries(store)) {
            if (data.history && data.history.includes(brokenId)) {
                fp = data;
                foundKey = id;
                logger.info(`[/heal] Matched old id via history`, { pageKey, brokenId, currentId: id });
                break;
            }
        }
    }

    // 3. If still not found -> fail
    if (!fp) {
        logger.warn("[/heal] Fingerprint not found", { pageKey, brokenId });
        return res.status(404).send({ message: "No fingerprint found.", confidence: 0 });
    }

    const $ = cheerio.load(domSnapshot);
    const candidates = [];
    $("*").each((_, el) => {
        const $el = $(el);
        const id = $el.attr("id");
        if (!id) return;

        const cand = {
            id,
            tagName: el.tagName || $el.prop("tagName") || "",
            className: $el.attr("class") || "",
            innerText: $el.text().trim()
        };
        const score = scoreCandidate(fp, cand);
        candidates.push({ cand, score });
    });

    if (!candidates.length) {
        logger.warn("[/heal] No id-bearing elements found in DOM snapshot", { pageKey });
        return res.status(404).send({ message: "No id-bearing elements in DOM.", confidence: 0 });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const topScore = best.score;

    const second = candidates[1];
    if (second && second.score === topScore && second.cand.id !== best.cand.id) {
        const message = `Ambiguous healing (top ties at ${topScore}%).`;
        logger.warn(`[/heal] ${message}`, { pageKey, brokenId, topScore });
        return res.status(409).send({ message, confidence: topScore });
    }

    if (topScore >= HEAL_THRESHOLD) {
        const found = best.cand;

        if (found.id !== brokenId) {
            const prev = store[brokenId];
            delete store[brokenId];
            store[found.id] = {
                ...found,
                lastSeen: nowISO(),
                history: [...(prev?.history || []), brokenId]
            };
        } else {
            store[found.id] = { ...found, lastSeen: nowISO(), history: store[found.id]?.history || [] };
        }
        saveSnapshots(pageKey, store);

        logger.info("[/heal] Successfully healed element", { pageKey, brokenId, healedId: found.id, confidence: topScore });
        return res.send({
            message: "Healed",
            confidence: topScore,
            matched: found
        });
    }

    logger.warn("[/heal] Healing failed due to low confidence", { pageKey, brokenId, topScore });
    return res.status(404).send({
        message: "Healing failed. No element strongly matched fingerprint.",
        confidence: topScore
    });
});

app.get("/snapshots", (req, res) => {
    logger.info("[/snapshots] Viewing snapshot list");
    const files = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json"));

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Snapshot Viewer</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        ul { list-style: none; padding: 0; }
        li { margin: 8px 0; }
        a { text-decoration: none; color: #007BFF; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>Snapshot Viewer</h1>
      <p>Available snapshot files:</p>
      <ul>
  `;

    files.forEach(f => {
        html += `<li><a href="/snapshots/${f}">${f}</a></li>`;
    });

    html += `
      </ul>
    </body>
    </html>
  `;

    res.send(html);
});

app.get("/snapshots/:file", (req, res) => {
    const file = req.params.file;
    logger.info("[/snapshots/:file] Viewing snapshot file", { file });
    const filePath = path.join(SNAPSHOTS_DIR, file);

    if (!fs.existsSync(filePath)) {
        logger.warn("[/snapshots/:file] Snapshot file not found", { file });
        return res.status(404).send("Snapshot not found");
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    let rows = "";
    Object.values(data).forEach(el => {
        rows += `
      <tr>
        <td>${el.id}</td>
        <td>${el.tagName}</td>
        <td>${el.className || ""}</td>
        <td>${el.innerText || ""}</td>
        <td>${el.lastSeen || ""}</td>
        <td class="history">${(el.history || []).join(", ")}</td>
      </tr>
    `;
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Snapshot - ${file}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
        h1 { color: #333; margin-bottom: 20px; }
        table { border-collapse: collapse; width: 100%; background: #fff; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background: #007BFF; color: white; }
        tr:nth-child(even) { background: #f2f2f2; }
        .history { font-size: 0.9em; color: #555; }
        a { color: #007BFF; text-decoration: none; }
        a:hover { text-decoration: underline; }
        #searchBox { padding: 8px; width: 300px; font-size: 14px; margin-bottom: 10px; }
        pre { background: #eee; padding: 15px; border-radius: 5px; overflow-x: auto; }
        #jsonView { display: none; }
      </style>
    </head>
    <body>
      <h1>Snapshot: ${file}</h1>
      <a href="/snapshots">&larr; Back to all snapshots</a>

      <div>
        <label for="searchBox"><strong>Search:</strong></label>
        <input id="searchBox" placeholder="Filter by id, tag, class, or text..." type="text">
      </div>

      <div id="tableView">
        <table id="snapshotTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tag</th>
              <th>Class</th>
              <th>Inner Text</th>
              <th>Last Seen</th>
              <th>History</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <script>
        const searchBox = document.getElementById('searchBox');

        searchBox.addEventListener('keyup', function() {
          const filter = searchBox.value.toLowerCase();
          const rows = document.querySelectorAll('#snapshotTable tbody tr');
          rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
          });
        });
      </script>
    </body>
    </html>
  `;

    res.send(html);
});

app.listen(PORT, () => {
    logger.info(`Healing server running at http://localhost:${PORT}`);
});