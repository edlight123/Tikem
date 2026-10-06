import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  dir: './',
})

const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  // The `tests/` directory holds Playwright E2E specs (run via `playwright test`),
  // not Jest unit tests — keep Jest from trying to load them.
  // `.claude/worktrees/` holds other agents' git worktrees (stale copies of
  // this repo, git-excluded): their tests run against THIS tree's modules and
  // fail for reasons that have nothing to do with it.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/', '/.next/', '<rootDir>/.claude/'],
  collectCoverageFrom: [
    'components/**/*.{js,jsx,ts,tsx}',
    'lib/**/*.{js,jsx,ts,tsx}',
    'app/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/coverage/**',
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
