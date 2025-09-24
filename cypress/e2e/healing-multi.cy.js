describe("Healing Multi Elements Page", () => {
    beforeEach(() => {
        // adjust path depending on how you're serving the HTML
        cy.visit("/healing-multi.html");
    });

    it("should interact with buttons", () => {
        cy.healGet("#login-btn").should("contain.text", "Login");
        cy.healGet("#signup-btn").should("contain.text", "Sign Up");
        cy.healGet("#logout-btn").should("contain.text", "Logout");
    });

    it("should interact with links", () => {
        cy.healGet("#home-link").should("have.attr", "href", "/home");
        cy.healGet("#profile-link").should("have.attr", "href", "/profile");
        cy.healGet("#settings-link").should("have.attr", "href", "/settings");
    });

    it("should interact with inputs and labels", () => {
        cy.healGet("#username-label").should("contain.text", "Username");
        cy.healGet("#username-input").type("myUser");

        cy.healGet("#password-label").should("contain.text", "Password");
        cy.healGet("#password-input").type("myPass");

        cy.healGet("#email-label").should("contain.text", "Email");
        cy.healGet("#email-input").type("test@example.com");
    });

    it("should verify messages", () => {
        cy.healGet("#welcome-message").should("contain.text", "Welcome to the app!");
        cy.healGet("#status-message").should("contain.text", "You are logged out.");
        cy.healGet("#error-message").should("contain.text", "An error occurred.");
    });
});
