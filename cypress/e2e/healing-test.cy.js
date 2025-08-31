describe('Self-Healing System', () => {
    it('should find an element and learn its fingerprint', () => {
        cy.visit('http://127.0.0.1:8080/cypress/fixtures/healing-page.html');
        cy.healGet('#submit-button').should('be.visible');
    });

    it('should "heal" by calling a fake backend when a selector is broken', () => {
        cy.visit('http://127.0.0.1:8080/healing-page-broken.html');
        cy.healGet('#submit-button')
            .should('be.visible')
            .and('have.id', 'new-submit-button-id');
    });

    it('should fail with an ambiguity error when multiple elements match', () => {
        // --- Test Setup ---
        // Step 1: First, "learn" the fingerprint from a non-ambiguous page.
        cy.visit('http://127.0.0.1:8080/healing-page-ambiguous.html');
        cy.healGet('#submit-button').should('be.visible');

        // Step 2: Now visit the page with the "evil twins".
        cy.visit('cypress/fixtures/healing-page-ambiguous.html');

        // --- Verification ---
        // We expect this command to fail. We use cy.on('fail', ...)
        // to catch the expected error and prevent the entire test run from stopping.
        cy.on('fail', (err) => {
            // Assert that the error message is the one we expect from our ambiguity logic.
            expect(err.message).to.include('Healing failed due to ambiguity');
        });

        // --- Action ---
        // This command will fail, and the 'fail' event listener above will catch it.
        cy.healGet('#submit-button');
    });
});