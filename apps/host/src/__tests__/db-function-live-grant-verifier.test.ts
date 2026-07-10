import { describe, expect, it } from 'vitest';
import {
  buildDbFunctionHardeningCatalogSql,
  compareDbFunctionHardeningRows,
  normalizeDbFunctionHardeningRows,
  type DbFunctionHardeningManifest,
  type LiveDbFunctionHardeningRow,
} from '../../../../scripts/verify-db-function-hardening-live';

const manifest: DbFunctionHardeningManifest = {
  functions: [
    {
      functionName: 'submit_quiz_results',
      allowedRoles: ['authenticated', 'service_role'],
      publicExecute: 'revoked',
      securityDefiner: true,
      searchPathPinned: true,
    },
    {
      functionName: 'match_rag_chunks_ncert',
      allowedRoles: ['authenticated', 'service_role'],
      publicExecute: 'revoked',
      securityDefiner: true,
      searchPathPinned: true,
    },
  ],
};

describe('RCA-18 live DB function hardening verifier', () => {
  it('passes when live catalog rows match the manifest grant and SECURITY DEFINER posture', () => {
    const rows: LiveDbFunctionHardeningRow[] = [
      {
        function_name: 'submit_quiz_results',
        identity_arguments: 'p_student_id uuid',
        security_definer: true,
        config: ['search_path=public'],
        public_can_execute: false,
        authenticated_can_execute: true,
        service_role_can_execute: true,
      },
      {
        function_name: 'match_rag_chunks_ncert',
        identity_arguments: 'query_embedding vector',
        security_definer: true,
        config: ['search_path=public, pg_catalog'],
        public_can_execute: false,
        authenticated_can_execute: true,
        service_role_can_execute: true,
      },
    ];

    const result = compareDbFunctionHardeningRows(manifest, rows);

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('accepts Supabase CLI JSON exports wrapped in a rows property', () => {
    const rows = normalizeDbFunctionHardeningRows({
      boundary: 'ignored',
      rows: [
        {
          function_name: 'submit_quiz_results',
          security_definer: true,
          config: ['search_path=public'],
          public_can_execute: false,
          authenticated_can_execute: true,
          service_role_can_execute: true,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].function_name).toBe('submit_quiz_results');
  });

  it('fails on missing functions, PUBLIC execute, missing allowed-role grants, unpinned search_path, and non-SECURITY DEFINER rows', () => {
    const rows: LiveDbFunctionHardeningRow[] = [
      {
        function_name: 'submit_quiz_results',
        identity_arguments: 'p_student_id uuid',
        security_definer: false,
        config: ['search_path=extensions'],
        public_can_execute: true,
        authenticated_can_execute: false,
        service_role_can_execute: true,
      },
    ];

    const result = compareDbFunctionHardeningRows(manifest, rows);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        functionName: 'submit_quiz_results',
        reason: 'SECURITY DEFINER is false; search_path is not pinned to public; PUBLIC can execute; authenticated cannot execute',
      },
      {
        functionName: 'match_rag_chunks_ncert',
        reason: 'function missing from live catalog query result',
      },
    ]);
  });

  it('generates read-only pg_catalog SQL for the manifest functions and required roles', () => {
    const sql = buildDbFunctionHardeningCatalogSql(manifest);

    expect(sql).toContain('RCA-18 live DB function hardening verifier');
    expect(sql).toContain("'submit_quiz_results'");
    expect(sql).toContain("'match_rag_chunks_ncert'");
    expect(sql).toContain("has_function_privilege('public', p.oid, 'EXECUTE')");
    expect(sql).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')");
    expect(sql).toContain("has_function_privilege('service_role', p.oid, 'EXECUTE')");

    for (const forbidden of ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'CREATE ', 'GRANT ', 'REVOKE ']) {
      expect(sql.toUpperCase(), `catalog verifier SQL must be read-only; found ${forbidden}`).not.toContain(forbidden);
    }
  });
});
