import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default [
  {
    files: ['src/**/*.ts'],
    ignores: ['dist/**', 'node_modules/**', 'src/games/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off', // Allow any — used intentionally at SQLite/HTTP/MCP boundaries
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General code quality
      'no-console': 'off', // CLI tool — console is expected
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'no-throw-literal': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Cohesion / complexity gates (added 2026-05-05 from CODE_QUALITY_AUDIT)
      // Threshold 30 surfaces the real offenders without burying us in noise.
      // The audit found one function at 139 (cli.ts:main), several at 70-80,
      // and many at 40-50. 30 is the line where "this needs splitting" starts.
      'complexity': ['warn', 30],
      // 800 LOC trips on agent.ts (1692), command-api.ts (1322), solve.ts (1094),
      // graphics.ts (1036). Surfaces god files; doesn't false-positive on the
      // ~750-line files that exist legitimately.
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],

      // Security-relevant
      'no-new-func': 'error',
    },
  },
  // Test-file overrides: relax rules that fire legitimately on test fixtures.
  // The audit found 435 of 507 warnings were non-null-assertions in tests, where
  // `!` is the idiomatic way to assert "this fixture is set up correctly."
  // Tests also commonly import-then-not-use type symbols for documentation.
  // Production code keeps the strict rules.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'complexity': 'off',
      'max-lines': 'off',
    },
  },
  prettier,
];
