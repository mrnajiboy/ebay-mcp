import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

function isHostedEnvironment(): boolean {
  return (
    process.env.DISABLE_DOTENVX === '1' ||
    process.env.DISABLE_DOTENVX === 'true' ||
    process.env.NIXPACKS === '1' ||
    process.env.NIXPACKS_METADATA !== undefined ||
    process.env.RENDER === 'true' ||
    process.env.RAILWAY_ENVIRONMENT !== undefined ||
    process.env.VERCEL === '1' ||
    process.env.K_SERVICE !== undefined ||
    process.env.AWS_EXECUTION_ENV !== undefined
  );
}

function hasLocalEnvFile(): boolean {
  return existsSync(resolve(process.cwd(), '.env'));
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    throw new Error('Usage: tsx src/scripts/env-check.ts <command> [args...]');
  }

  const hosted = isHostedEnvironment();
  const useDotenvx = !hosted && hasLocalEnvFile();
  const [command, ...commandArgs] = args;

  const finalCommand = useDotenvx ? 'npx' : command;
  const finalArgs = useDotenvx
    ? // --overload ensures .env values always win over any pre-set shell env vars
      // (e.g. a stale EBAY_TOKEN_STORE_BACKEND exported in .zshrc from a previous run)
      ['-y', '@dotenvx/dotenvx', 'run', '--overload', '--', command, ...commandArgs]
    : commandArgs;

  const modeMessage = hosted
    ? '[env-launcher] Hosted environment detected, using platform-provided env vars'
    : useDotenvx
      ? '[env-launcher] Local .env detected, loading env via dotenvx'
      : '[env-launcher] No local .env detected, running without dotenvx';

  console.log(modeMessage);

  const child = spawn(finalCommand, finalArgs, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  try {
    main();
  } catch (error) {
    console.error('[env-launcher] Failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
