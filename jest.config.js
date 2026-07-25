/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/agent/**/*.test.ts", "<rootDir>/src/notes/**/*.test.ts", "<rootDir>/src/settings/**/*.test.ts"],
  // Live-API smoke tests hit the real OpenRouter API and cost money — never
  // run them as part of the normal suite or CI. See `npm run test:live`.
  testPathIgnorePatterns: ["/node_modules/", "\\.live\\.test\\.ts$"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};
