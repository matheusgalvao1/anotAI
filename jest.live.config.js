const base = require("./jest.config.js");

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testPathIgnorePatterns: ["/node_modules/"],
  testMatch: ["<rootDir>/src/agent/**/*.live.test.ts"],
  // Loads .env (OPENROUTER_API_KEY, OPENROUTER_DEFAULT_MODEL, ...) so
  // `npm run test:live` works with no inline env vars needed. Scoped to this
  // config only — the main suite and the app itself never load .env (PRD §8:
  // the shipped app reads keys from the OS keychain, never env vars).
  setupFiles: ["dotenv/config"],
};
