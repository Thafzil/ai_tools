const { shareAll, withNativeFederation } = require('@angular-architects/native-federation/config');

const isRemote = process.env.NF_TARGET === 'remote';

module.exports = withNativeFederation({
  name: isRemote ? 'markdownAstStudio' : 'decodersShell',

  exposes: isRemote
    ? {
        './MarkdownStudioModule': './src/app/tools/markdown-studio/markdown-studio.module.ts',
        './MarkdownStudio': './src/app/tools/markdown-studio/markdown-studio.component.ts',
      }
    : {},

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
  },

  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket'],

  features: {
    ignoreUnusedDeps: true,
  },
});
