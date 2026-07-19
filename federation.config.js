const { shareAll, withNativeFederation } = require('@angular-architects/native-federation/config');

const target = process.env.NF_TARGET;
const isMarkdownRemote = target === 'remote' || target === 'markdown';
const isNeatCodeRemote = target === 'neatcode';
const isRemote = isMarkdownRemote || isNeatCodeRemote;

function getRemoteName() {
  if (isMarkdownRemote) {
    return 'markdownAstStudio';
  }

  if (isNeatCodeRemote) {
    return 'neatCodeAcademy';
  }

  return 'workspaceShell';
}

function getRemoteExposes() {
  if (isMarkdownRemote) {
    return {
      './MarkdownStudioModule': './src/app/tools/markdown-studio/markdown-studio.module.ts',
      './MarkdownStudio': './src/app/tools/markdown-studio/markdown-studio.component.ts',
    };
  }

  if (isNeatCodeRemote) {
    return {
      './NeatCodeModule': './src/app/tools/neatcode-academy/neatcode-academy.module.ts',
      './NeatCode': './src/app/tools/neatcode-academy/neatcode-academy.component.ts',
    };
  }

  return {};
}

module.exports = withNativeFederation({
  name: getRemoteName(),

  exposes: isRemote ? getRemoteExposes() : {},

  shared: {
    ...shareAll(
      { singleton: true, strictVersion: true, requiredVersion: 'auto' },
      {
        overrides: {
          '@angular/core': {
            singleton: true,
            strictVersion: true,
            requiredVersion: 'auto',
            includeSecondaries: { keepAll: true },
          },
        },
      },
    ),
  },

  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket'],

  features: {
    ignoreUnusedDeps: true,
  },
});
