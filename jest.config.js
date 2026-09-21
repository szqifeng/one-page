const { configUmiAlias, createConfig } = require('@umijs/max/test');

module.exports = async () =>
  configUmiAlias({
    ...createConfig({
      target: 'browser',
      jsTransformer: 'esbuild',
      jsTransformerOpts: { jsx: 'automatic' },
    }),
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  });
