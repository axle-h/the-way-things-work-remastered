import { describe, expect, it } from 'vitest';
import { scanText } from './scan.ts';

// Forbidden tokens are assembled at runtime so that this file passes the check itself.
const t = (...parts: string[]) => parts.join('');

describe('scanText', () => {
  it.each([
    t('FUN', '_1018_8534'),
    t('DAT', '_12c0_0042'),
    t('LAB', '_1000_0b44'),
    t('thunk_', 'FUN', '_00401000'),
    t('PTR_', 'DAT', '_12c0_0010'),
    t('switchD', '_1008_0b44'),
    t('sub', '_401000'),
    t('u', 'Var1'),
    t('i', 'Var12'),
    t('b', 'Var3'),
    t('s', 'Var4'),
    t('c', 'Var5'),
    t('l', 'Var6'),
    t('pv', 'Var7'),
    t('pu', 'Var8'),
    t('p', 'Var9'),
    t('au', 'Stack_14'),
    t('param', '_1'),
    t('local', '_1c'),
    t('local', '_res0'),
    t('in', '_stack_00000004'),
    t('in', '_AX'),
    t('extraout', '_DX'),
    t('unaff', '_SI'),
    t('undefined', '2'),
    t('CONCAT', '22(a, b)'),
    t('SUB', '42(x, 0)'),
    t('ZEXT', '24(x)'),
    t('SEXT', '24(x)'),
    t('CARRY', '2(a, b)'),
  ])('flags %s', (token) => {
    const [finding] = scanText(`const x = 1;\n  y = ${token};`);
    expect(finding).toMatchObject({ line: 2, column: 7 });
    expect(token.startsWith(finding!.match)).toBe(true);
  });

  it.each([
    'function fun_time() {}',
    'const DATA_SIZE = 4; const LABEL = 1;',
    'const parameter_1 = 0; const params = [];',
    'localStorage.getItem(key); const local_cache = 1; const local_bad = 2;',
    'const envVar = 1; const myVar1 = 2; const Var1 = 3;',
    'const value = undefined; let x: undefined;',
    'const SUBTITLE = 1; const CONCATENATED = 2; const subtotal_A = 3;',
    'in_progress; in_order; unaffected; extraordinary;',
    'const PTR_SIZE = 4; const word_count = 7; const offset_1234 = 0;',
    'Provenance: 1018:8534 and 12c0:0042 are fine in comments.',
  ])('ignores %s', (text) => {
    expect(scanText(text)).toEqual([]);
  });
});
