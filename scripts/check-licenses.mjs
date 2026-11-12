// Fails when a dependency's license is not on the allowlist in licenses.allow.json.
//
//   node scripts/check-licenses.mjs js   every pnpm workspace (license-checker-rseidelsohn)
//   node scripts/check-licenses.mjs py   apps/api (pip-licenses, through uv)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'licenses.allow.json'), 'utf8'));
const allow = config.allow;

const withoutComment = (obj) => Object.entries(obj).filter(([key]) => key !== '//');

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function checkJs() {
  const workspaces = [
    '.',
    ...readdirSync(join(root, 'packages')).map((name) => join('packages', name)),
    join('apps', 'web'),
  ].filter((dir) => existsSync(join(root, dir, 'package.json')));
  const exceptions = withoutComment(config.exceptions.js).map(([name]) => name);

  let failed = false;
  for (const dir of workspaces) {
    const result = run(
      join(root, 'node_modules', '.bin', 'license-checker-rseidelsohn'),
      [
        '--start',
        join(root, dir),
        '--excludePrivatePackages',
        '--onlyAllow',
        allow.join(';'),
        '--excludePackages',
        exceptions.join(';'),
        '--summary',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    if (result.status === 0) {
      console.log(`ok    ${dir}`);
    } else {
      console.log(`FAIL  ${dir}`);
      failed = true;
    }
  }
  return !failed;
}

function checkPy() {
  const cwd = join(root, 'apps', 'api');
  const pipLicenses = ['run', '--frozen', 'pip-licenses', '--from=mixed'];
  const aliases = new Map(withoutComment(config.pythonAliases));
  const exceptions = withoutComment(config.exceptions.python).map(([name]) => name);

  // pip-licenses compares whole strings, so an SPDX expression such as
  // "Apache-2.0 OR BSD-2-Clause" never matches. Work out which reported strings are
  // acceptable, then let --allow-only enforce exactly that set.
  const isAllowed = (id) => allow.includes(aliases.get(id) ?? id);
  const acceptable = (expression) =>
    expression.split(' OR ').some((option) => option.split(' AND ').every(isAllowed));

  const listed = run('uv', [...pipLicenses, '--format=json'], { cwd });
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr);
    return false;
  }
  const reported = new Set(JSON.parse(listed.stdout).map((pkg) => pkg.License));
  const allowOnly = [...new Set([...allow, ...[...reported].filter(acceptable)])];

  const result = run(
    'uv',
    [...pipLicenses, `--allow-only=${allowOnly.join(';')}`, '--ignore-packages', ...exceptions],
    { cwd, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  console.log(result.status === 0 ? 'ok    apps/api' : 'FAIL  apps/api');
  return result.status === 0;
}

const checks = { js: checkJs, py: checkPy };
const check = checks[process.argv[2]];
if (!check) {
  console.error('Usage: node scripts/check-licenses.mjs js|py');
  process.exit(2);
}
process.exit(check() ? 0 : 1);
