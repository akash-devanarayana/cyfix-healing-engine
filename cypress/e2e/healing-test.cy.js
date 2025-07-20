describe('Self-Healing System', () => {
    it('should find an element and learn its fingerprint', () => {
        cy.visit('http://127.0.0.1:8080/healing-page.html');
        cy.healGet('#submit-button').should('be.visible');
    });

    it('should "heal" by calling a fake backend when a selector is broken', () => {
        cy.visit('http://127.0.0.1:8080/healing-page-broken.html');
        cy.healGet('#submit-button')
            .should('be.visible')
            .and('have.id', 'new-submit-button-id');
    });
});