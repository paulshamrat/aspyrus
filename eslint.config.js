import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: [
      'backend/src/localleaf/assets/**',
      'dist/**',
      'build/**',
      'demo/**',
      '.venv/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.mjs', '**/*.cjs'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['editor/src/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];
