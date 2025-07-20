/**
 * A basic wrapper around cy.get() to serve as our starting point.
 * This will eventually contain our healing logic.
 *
 * @param {string} selector - The selector for the element to find.
 */
Cypress.Commands.add('healGet', (selector) => {
    cy.log(`[healGet] Attempting to find selector: ${selector}`);

    return cy.get('body').then($body => {
        if ($body.find(selector).length > 0) {
            cy.log('[healGet] ✔️ Selector found! Learning its fingerprint...');
            return cy.get(selector).then($element => {
                const fingerprint = {
                    tagName: $element.prop('tagName'),
                    innerText: $element.text().trim(),
                    className: $element.attr('class'),
                    placeholder: $element.attr('placeholder'),
                    type: $element.attr('type'),
                    'aria-label': $element.attr('aria-label'),
                };

                // Remove any undefined properties for a cleaner object
                Object.keys(fingerprint).forEach(key => fingerprint[key] === undefined && delete fingerprint[key]);

                return cy.request('POST', '/learn', {selector, fingerprint})
                    .then(() => {
                        return $element;
                    });
            });
        } else {
            cy.log(`[healGet] ❌ Selector "${selector}" not found. Contacting healing backend...`);
            return cy.document().then(doc => {
                return cy.request({
                    method: 'POST',
                    url: '/heal',
                    body: {
                        brokenSelector: selector,
                        domSnapshot: doc.body.innerHTML
                    },
                    failOnStatusCode: false
                }).then((response) => {
                    cy.log('[healGet] Backend response:', JSON.stringify(response.body));
                    const healedSelector = response.body.healedSelector;
                    console.log(JSON.stringify(response));
                    if (response.status === 200 && healedSelector) {
                        cy.log(`[healGet] ✨ Backend provided a healed selector: "${healedSelector}"`);
                        cy.log('[healGet] Retrying with the new selector...');
                        return cy.get(healedSelector);
                    } else {
                        throw new Error(`[healGet] Healing failed for selector: "${selector}". Backend could not find a match.`);
                    }
                });
            });
        }
    });
});