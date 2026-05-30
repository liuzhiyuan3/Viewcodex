import { chmod, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

if (process.platform === 'darwin') {
  const helperPath = path.join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${process.arch}`,
    'spawn-helper',
  );

  try {
    await access(helperPath);
    await chmod(helperPath, 0o755);
  } catch {
    // node-pty may be rebuilt from source or absent during partial installs.
  }
}

