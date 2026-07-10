import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface DbFunctionHardeningEntry {
  id: string;
  functionName: string;
  definitionMigration: string;
  grantMigration: string;
  owner: string;
  risk: string;
  securityDefiner: true;
  searchPathPinned: true;
  publicExecute: 'revoked';
  allowedRoles: string[];
  ownershipCheck: 'auth_uid_student_owner' | 'not_applicable';
  grantPosture: string;
}

function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n\r]*/g, '');
}

function functionBlock(sql: string, functionName: string): string {
  const pattern = new RegExp(
    String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:"public"|public)\.?"?${functionName}"?\s*\(`,
    'i',
  );
  const match = pattern.exec(sql);
  expect(match, `${functionName} function definition missing`).not.toBeNull();

  const start = match?.index ?? 0;
  const end = sql.indexOf('\n$$;', start);
  const quotedEnd = sql.indexOf('\n$_$;', start);
  const blockEnd = [end, quotedEnd].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
  expect(blockEnd, `${functionName} function body terminator missing`).toBeGreaterThan(start);

  return sql.slice(start, blockEnd);
}

describe('DB function hardening manifest (RCA-18)', () => {
  it('tracks high-risk SECURITY DEFINER RPCs with pinned search_path and grant posture', () => {
    expect(existsSync(repoPath('scripts/db-function-hardening.json'))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(repoPath('scripts/db-function-hardening.json'), 'utf8'),
    ) as { functions: DbFunctionHardeningEntry[] };

    const byName = new Map(manifest.functions.map((entry) => [entry.functionName, entry]));
    const requiredFunctions = [
      'submit_quiz_results',
      'submit_quiz_results_v2',
      'match_rag_chunks_ncert',
    ];

    for (const functionName of requiredFunctions) {
      expect(byName.has(functionName), `${functionName} missing from DB hardening manifest`).toBe(true);
    }

    for (const entry of manifest.functions) {
      expect(entry.id).toMatch(/^RCA-18-/);
      expect(entry.owner).toMatch(/\S/);
      expect(entry.risk).toMatch(/\S/);
      expect(entry.grantPosture).toMatch(/\S/);
      expect(entry.securityDefiner).toBe(true);
      expect(entry.searchPathPinned).toBe(true);
      expect(entry.publicExecute).toBe('revoked');
      expect(entry.allowedRoles.sort()).toEqual(['authenticated', 'service_role']);
      expect(['auth_uid_student_owner', 'not_applicable']).toContain(entry.ownershipCheck);
      expect(
        existsSync(repoPath(entry.definitionMigration)),
        `${entry.functionName} definition migration missing`,
      ).toBe(true);
      expect(existsSync(repoPath(entry.grantMigration)), `${entry.functionName} grant migration missing`).toBe(true);

      const sql = executableSql(readFileSync(repoPath(entry.definitionMigration), 'utf8'));
      const block = functionBlock(sql, entry.functionName);
      const grantSql = executableSql(readFileSync(repoPath(entry.grantMigration), 'utf8'));

      expect(block, `${entry.functionName} must remain SECURITY DEFINER`).toMatch(/SECURITY\s+DEFINER/i);
      expect(block, `${entry.functionName} must pin search_path to public`).toMatch(
        /SET\s+"?search_path"?\s*(?:=|TO)\s+(?:'?public'?|"public")/i,
      );
      expect(grantSql, `${entry.functionName} must revoke default PUBLIC execute`).toMatch(
        new RegExp(String.raw`REVOKE\s+EXECUTE\s+ON\s+FUNCTION[\s\S]{0,260}${entry.functionName}[\s\S]{0,260}FROM\s+PUBLIC`, 'i'),
      );
      expect(grantSql, `${entry.functionName} must explicitly grant allowed execute roles`).toMatch(
        new RegExp(
          String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]{0,260}${entry.functionName}[\s\S]{0,260}TO\s+authenticated\s*,\s*service_role`,
          'i',
        ),
      );

      if (entry.ownershipCheck === 'auth_uid_student_owner') {
        expect(block, `${entry.functionName} must check auth.uid() ownership`).toMatch(/auth\.uid\(\)/i);
        expect(block, `${entry.functionName} must bind caller to students.auth_user_id`).toMatch(
          /students[\s\S]{0,240}auth_user_id\s*=\s*auth\.uid\(\)/i,
        );
      }
    }
  });
});
