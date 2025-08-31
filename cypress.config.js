import {defineConfig} from "cypress";

export default defineConfig({
    e2e: {
        specPattern: "cypress/e2e/**/*.{cy,spec}.{js,ts}",
        baseUrl: "http://127.0.0.1:8080",
    },
});