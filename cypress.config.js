const {defineConfig} = require("cypress");

module.exports = defineConfig({
    e2e: {
        baseUrl: "http://127.0.0.1:8080/cypress/fixtures",
        setupNodeEvents(on, config) {
            return config;
        }
    },
    env: {
        HEALING_SERVER_URL: "http://localhost:3000"
    }
});
