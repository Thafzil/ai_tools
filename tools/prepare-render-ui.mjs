#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..');
const mode = process.argv[2] || 'bundled';

const shellBrowserDir = resolve(repoRoot, 'dist/decoders-markdown/browser');
const markdownRemoteDir = resolve(repoRoot, 'dist/markdown-studio-remote/browser');
const neatCodeRemoteDir = resolve(repoRoot, 'dist/neatcode-remote/browser');
const manifestPath = resolve(shellBrowserDir, 'federation.manifest.json');

function ensurePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} was not found at ${path}. Run the matching build first.`);
  }
}

function writeManifest(entries) {
  ensurePath(shellBrowserDir, 'Shell build output');
  writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
}

function copyRemote(remoteName, sourceDir) {
  ensurePath(sourceDir, `${remoteName} remote build output`);

  const destination = resolve(shellBrowserDir, 'remotes', remoteName);
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(sourceDir, destination, { recursive: true });
}

if (mode === 'bundled') {
  copyRemote('markdown-studio', markdownRemoteDir);
  copyRemote('neatcode', neatCodeRemoteDir);
  writeManifest({
    markdownAstStudio: '/remotes/markdown-studio/remoteEntry.json',
    neatCodeAcademy: '/remotes/neatcode/remoteEntry.json',
  });

  console.log('Prepared bundled Render UI output at dist/decoders-markdown/browser');
  process.exit(0);
}

if (mode === 'external') {
  const markdownRemoteEntry = process.env.MARKDOWN_REMOTE_ENTRY;
  const neatCodeRemoteEntry = process.env.NEATCODE_REMOTE_ENTRY;

  if (!markdownRemoteEntry || !neatCodeRemoteEntry) {
    throw new Error(
      'External Render UI builds require MARKDOWN_REMOTE_ENTRY and NEATCODE_REMOTE_ENTRY.',
    );
  }

  writeManifest({
    markdownAstStudio: markdownRemoteEntry,
    neatCodeAcademy: neatCodeRemoteEntry,
  });

  console.log('Prepared external Render shell federation manifest.');
  process.exit(0);
}

throw new Error(`Unknown Render UI preparation mode: ${mode}`);
