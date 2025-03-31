module.exports = {
  testEnvironment: 'node', // Correct, as you are testing a Node.js backend
  coverageDirectory: 'coverage', // Stores test coverage reports
  testTimeout: 30000, // Sets a 30-second timeout for tests (good for database tests)
  testMatch: ['**/tests/**/*.test.js'], // Matches all test files inside the "tests" folder
};
