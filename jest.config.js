module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '@sgip/types':     '<rootDir>/types/index.ts',
    '@sgip/schemas':   '<rootDir>/schemas/index.ts',
    '@sgip/contracts': '<rootDir>/contracts/index.ts',
    '@sgip/shared':    '<rootDir>/shared/index.ts',
    '@sgip/graph':     '<rootDir>/graph/index.ts',
    '@sgip/core':      '<rootDir>/core/index.ts'
  }
};
