describe('Self-Healing Logic: Ambiguous Case', () => {

    it('should fail with an "Ambiguous" error when multiple elements match equally', () => {
        cy.visit('healing-ambiguous.html');
        cy.healGet('#submit-button').should('contain.text', 'Submit');
    });

});