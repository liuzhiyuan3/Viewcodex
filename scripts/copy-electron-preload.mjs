import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const outputDir = path.join(process.cwd(), 'dist-electron');
await mkdir(outputDir, { recursive: true });
await copyFile(
  path.join(process.cwd(), 'electron', 'preload.cjs'),
  path.join(outputDir, 'preload.cjs'),
);

