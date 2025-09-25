const express = require("express");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const HEAL_THRESHOLD = process.env.HEAL_THRESHOLD
    ? parseFloat(process.env.HEAL_THRESHOLD)
    : 80; // %

// ---- Utils ----
app.use(express.json({limit: "50mb"}));

const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, {recursive: true});

function fileKeyFromPageKey(pageKey) {
    // pageKey e.g. "localhost_/healing-page.html"
    return pageKey.replace(/[^\w\-]+/g, "_");
}

function loadSnapshots(pageKey) {
    const file = path.join(SNAPSHOTS_DIR, fileKeyFromPageKey(pageKey) + ".json");
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function saveSnapshots(pageKey, data) {
    const snapshotDir = path.join(__dirname, 'snapshots');
    fs.mkdirSync(snapshotDir, {recursive: true});
    const file = path.join(SNAPSHOTS_DIR, fileKeyFromPageKey(pageKey) + ".json");
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
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
    return Math.round((tagScore + classScore + textScore) * 10) / 10; // one decimal
}

// ========== API ==========

// Learn / upsert snapshot by *element id* for a page
// Body: { pageKey, id, tagName, className, innerText }
app.post("/learn", (req, res) => {
    const {pageKey, id, tagName, className = "", innerText = ""} = req.body || {};
    if (!pageKey || !id || !tagName) {
        return res.status(400).send({message: "pageKey, id, tagName required"});
    }

    const store = loadSnapshots(pageKey);
    store[id] = {
        id,
        tagName,
        className,
        innerText,
        lastSeen: nowISO(),
        history: store[id]?.history || []
    };
    saveSnapshots(pageKey, store);
    return res.send({message: "Snapshot stored", stored: store[id]});
});

// Heal using stored fingerprint under *brokenId*
// Body: { pageKey, brokenId, domSnapshot }
app.post("/heal", (req, res) => {
    const {pageKey, brokenId, domSnapshot} = req.body || {};
    if (!pageKey || !brokenId || !domSnapshot) {
        return res.status(400).send({message: "pageKey, brokenId, domSnapshot required"});
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
                console.log(`[heal] Matched old id "${brokenId}" via history → current id "${id}"`);
                break;
            }
        }
    }

    // 3. If still not found → fail
    if (!fp) {
        return res.status(404).send({message: "No fingerprint found.", confidence: 0});
    }


    const $ = cheerio.load(domSnapshot);

    // Consider only elements that have an id (since snapshot keys are ids)
    const candidates = [];
    $("*").each((_, el) => {
        const $el = $(el);
        const id = $el.attr("id");
        if (!id) return;

        const cand = {
            id,
            tagName: el.tagName || $el.prop("tagName") || "", // cheerio lowercases tagName
            className: $el.attr("class") || "",
            innerText: $el.text().trim()
        };
        const score = scoreCandidate(fp, cand);
        candidates.push({cand, score});
    });

    if (!candidates.length) {
        return res.status(404).send({message: "No id-bearing elements in DOM.", confidence: 0});
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const topScore = best.score;

    // If there is a tie on top score with a different id, call it ambiguous
    const second = candidates[1];
    if (second && second.score === topScore && second.cand.id !== best.cand.id) {
        return res.status(409).send({
            message: `Ambiguous healing (top ties at ${topScore}%).`,
            confidence: topScore
        });
    }

    if (topScore >= HEAL_THRESHOLD) {
        const found = best.cand;

        // replace snapshot: move from old id -> new id if needed
        if (found.id !== brokenId) {
            const prev = store[brokenId];
            delete store[brokenId];
            store[found.id] = {
                ...found,
                lastSeen: nowISO(),
                history: [...(prev?.history || []), brokenId]
            };
        } else {
            store[found.id] = {...found, lastSeen: nowISO(), history: store[found.id]?.history || []};
        }
        saveSnapshots(pageKey, store);

        return res.send({
            message: "Healed",
            confidence: topScore,
            matched: found
        });
    }

    return res.status(404).send({
        message: "Healing failed. No element strongly matched fingerprint.",
        confidence: topScore
    });
});

app.get("/snapshots", (req, res) => {
    const files = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json"));

    let html = `
    <!DOCTYPE html>
    <html>
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

// Serve snapshot file as pretty HTML table
app.get("/snapshots/:file", (req, res) => {
    const filePath = path.join(SNAPSHOTS_DIR, req.params.file);
    if (!fs.existsSync(filePath)) {
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
    <html>
    <head>
      <title>Snapshot - ${req.params.file}</title>
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
        #toggleBtn { margin: 10px 0; padding: 6px 12px; background: #007BFF; color: white; border: none; border-radius: 4px; cursor: pointer; }
        #toggleBtn:hover { background: #0056b3; }
        pre { background: #eee; padding: 15px; border-radius: 5px; overflow-x: auto; }
        #jsonView { display: none; }
      </style>
    </head>
    <body>
      <h1>Snapshot: ${req.params.file}</h1>
      <a href="/snapshots">&larr; Back to all snapshots</a>

      <div>
        <label for="searchBox"><strong>Search:</strong></label>
        <input type="text" id="searchBox" placeholder="Filter by id, tag, class, or text...">
        <button id="toggleBtn">Switch to JSON View</button>
      </div>

      <!-- Pretty Table View -->
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

      <!-- Raw JSON View -->
      <div id="jsonView">
        <pre>${JSON.stringify(data, null, 2)}</pre>
      </div>

      <script>
        const searchBox = document.getElementById('searchBox');
        const toggleBtn = document.getElementById('toggleBtn');
        const tableView = document.getElementById('tableView');
        const jsonView = document.getElementById('jsonView');

        // Search filter
        searchBox.addEventListener('keyup', function() {
          const filter = searchBox.value.toLowerCase();
          const rows = document.querySelectorAll('#snapshotTable tbody tr');
          rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
          });
        });

        // Toggle views
        toggleBtn.addEventListener('click', function() {
          if (tableView.style.display === 'none') {
            tableView.style.display = '';
            jsonView.style.display = 'none';
            toggleBtn.textContent = 'Switch to JSON View';
          } else {
            tableView.style.display = 'none';
            jsonView.style.display = '';
            toggleBtn.textContent = 'Switch to Table View';
          }
        });
      </script>
    </body>
    </html>
  `;

    res.send(html);
});


app.listen(PORT, () => {
    console.log(`Healing server running at http://localhost:${PORT}`);
});
