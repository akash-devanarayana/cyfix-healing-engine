/**
 *
 * @param {string} selector
 */
Cypress.Commands.add("healGet", (selector) => {
    cy.log(`[healGet] Attempting to find selector: ${selector}`);

    return cy.get("body").then(($body) => {
        if ($body.find(selector).length > 0) {
            cy.log('[healGet] ✔️ Selector found! Learning its fingerprint...');

            return cy.get(selector).then($element => {
                return cy.document().then(doc => {
                    const fingerprint = {
                        tagName: $element.prop('tagName'),
                        innerText: $element.text().trim(),
                        className: $element.attr('class'),
                        placeholder: $element.attr('placeholder'),
                        type: $element.attr('type'),
                        'aria-label': $element.attr('aria-label')
                    };
                    Object.keys(fingerprint).forEach(key => fingerprint[key] === undefined && delete fingerprint[key]);

                    return cy.request('POST', '/learn', {
                        selector,
                        fingerprint,
                        domSnapshot: doc.body.innerHTML
                    })
                        .then(() => {
                            return $element;
                        });
                });
            });
        } else {
            cy.log(
                `[healGet] ❌ Selector "${selector}" not found. Contacting healing backend...`
            );
            return cy.document().then((doc) => {
                return cy
                    .request({
                        method: "POST",
                        url: "/heal",
                        body: {brokenSelector: selector, domSnapshot: doc.body.innerHTML},
                        failOnStatusCode: false,
                    })
                    .then((response) => {
                        // Case 1: Successful Heal
                        if (response.status === 200 && response.body.healedSelector) {
                            cy.log(
                                `[healGet] ✨ Backend provided a healed selector: "${response.body.healedSelector}"`
                            );
                            return cy.get(response.body.healedSelector);
                        }
                        // Case 2: Ambiguous Match
                        else if (response.status === 409) {
                            throw new Error(
                                `[healGet] Healing failed due to ambiguity. ${response.body.message}`
                            );
                        }
                        // Case 3: Any other failure
                        else {
                            throw new Error(
                                `[healGet] Healing failed for selector: "${selector}". Backend could not find a match.`
                            );
                        }
                    });
            });
        }
    });
});
