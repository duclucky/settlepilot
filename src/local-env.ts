import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function updateLocalEnv(envFile: string, values: Record<string, string>) {
  const target = resolve(envFile);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current ? current.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error('INVALID_ENV_VALUE');
    let encoded = value;
    if (/[\s#'"]/.test(value)) {
      if (!value.includes("'")) encoded = `'${value}'`;
      else if (!value.includes('"')) encoded = `"${value}"`;
      else throw new Error('INVALID_ENV_VALUE');
    }
    const matches = new RegExp(`^\\s*${key}\\s*=`);
    const index = lines.findIndex(line => matches.test(line));
    const next = `${key}=${encoded}`;
    if (index >= 0) {
      lines[index] = next;
      // Node uses the last duplicate assignment. Do not let an old value win after restart.
      for (let duplicate = lines.length - 1; duplicate > index; duplicate--) if (matches.test(lines[duplicate])) lines.splice(duplicate, 1);
    } else lines.push(next);
  }
  const temporary = resolve(dirname(target), `.tameion-env-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${lines.join(newline)}${newline}`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
}
