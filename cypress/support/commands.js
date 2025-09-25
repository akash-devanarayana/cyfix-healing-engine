const HEAL_URL = Cypress.env("HEALING_SERVER_URL") || "http://localhost:3000";

// Turn URL into safe pageKey
function getPageKey(urlStr) {
    const u = new URL(urlStr);
    return `${u.host}${u.pathname}`.replace(/[^\w\-]+/g, "_");
}

// Save snapshot for element
function learnSnapshot($el) {
    const id = $el.attr("id");
    if (!id) return;

    const payload = {
        id,
        tagName: $el.prop("tagName"),
        className: $el.attr("class") || "",
        innerText: $el.text().trim()
    };

    return cy.url().then((url) => {
        return cy.request("POST", `${HEAL_URL}/learn`, {
            pageKey: getPageKey(url),
            ...payload
        });
    });
}

// New command: cy.healGet
Cypress.Commands.add("healGet", (selector, options = {}) => {
    return cy.get("body", {log: false}).then(($body) => {
        // Case 1: element found normally
        if ($body.find(selector).length) {
            return cy.get(selector, options).then(($el) => {
                const id = $el.attr("id");
                if (id) {
                    cy.log(`[heal] Learned snapshot for #${id}`);
                    learnSnapshot($el);
                }
                return $el;
            });
        }

        // Case 2: element not found → attempt healing
        const m = typeof selector === "string" ? selector.match(/^#([\w\-\.:]+)$/) : null;
        if (!m) throw new Error(`[heal] Only ID selectors supported. Failed: "${selector}"`);
        const brokenId = m[1];

        cy.log(`[heal] Element "${selector}" not found. Trying healing...`);

        return cy.document().then((doc) => {
            const domSnapshot = doc.documentElement.outerHTML;
            return cy.url().then((url) => {
                return cy.request({
                    method: "POST",
                    url: `${HEAL_URL}/heal`,
                    failOnStatusCode: false,
                    body: {
                        pageKey: getPageKey(url),
                        brokenId,
                        domSnapshot
                    }
                }).then((resp) => {
                    if (resp.status === 200 && resp.body?.matched?.id) {
                        const healedId = resp.body.matched.id;
                        cy.log(`[heal] SUCCESS: "${selector}" healed to "#${healedId}" (confidence ${resp.body.confidence}%)`);
                        return cy.get(`#${healedId}`, options);
                    } else if (resp.status === 409) {
                        cy.log(`[heal] AMBIGUOUS: ${resp.body?.message}`);
                        throw new Error(`[heal] Ambiguous: ${resp.body?.message}`);
                    } else {
                        cy.log(`[heal] FAILED: Could not heal "${selector}". Confidence: ${resp.body?.confidence ?? 0}%`);
                        throw new Error(`[heal] Failed for "${selector}". Confidence: ${resp.body?.confidence ?? 0}%`);
                    }
                });
            });
        });
    });
});

