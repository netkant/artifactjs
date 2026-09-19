import { describe, expect, it, vi } from 'vitest';
import { artifact, readArtifact } from '../src/index';
import { waitForValue } from './wait';

describe('tiered cache keys', () => {
    describe('tier 0: zero arguments', () => {
        it('uses default key for factory() and factory with no args', () => {
            const counter = artifact(() => Math.random());
            
            const val1 = readArtifact(counter);
            const val2 = readArtifact(counter());
            
            expect(val1).toBe(val2);
        });
    });

    describe('tier 1: single primitive', () => {
        it('caches single string argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data('hello'));
            await waitForValue(data('hello'));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('caches single number argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(42));
            await waitForValue(data(42));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('caches single boolean argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(true));
            await waitForValue(data(true));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('caches single null argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(null));
            await waitForValue(data(null));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('caches single undefined argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(undefined));
            await waitForValue(data(undefined));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('caches single bigint argument', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(123n));
            await waitForValue(data(123n));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('distinguishes different primitive values', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(1));
            await waitForValue(data(2));
            await waitForValue(data('1'));
            await waitForValue(data(true));

            expect(init).toHaveBeenCalledTimes(4);
        });

        it('distinguishes 0 from "0" and false', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(0));
            await waitForValue(data('0'));
            await waitForValue(data(false));

            expect(init).toHaveBeenCalledTimes(3);
        });
    });

    describe('tier 2: flat object (one level, primitives only)', () => {
        it('caches flat object with primitive values', async () => {
            const init = vi.fn(async ({ a, b }: { a: number; b: string }) => ({ a, b }));
            const data = artifact(init);

            await waitForValue(data({ a: 1, b: 'test' }));
            await waitForValue(data({ a: 1, b: 'test' }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('treats {a, b} and {b, a} as the same (key order invariant)', async () => {
            const init = vi.fn(async ({ a, b }: { a: number; b: number }) => ({ a, b }));
            const data = artifact(init);

            await waitForValue(data({ a: 1, b: 2 }));
            await waitForValue(data({ b: 2, a: 1 }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('distinguishes different flat object values', async () => {
            const init = vi.fn(async ({ a, b }: { a: number; b: number }) => ({ a, b }));
            const data = artifact(init);

            await waitForValue(data({ a: 1, b: 2 }));
            await waitForValue(data({ a: 1, b: 3 }));
            await waitForValue(data({ a: 2, b: 2 }));

            expect(init).toHaveBeenCalledTimes(3);
        });

        it('handles all primitive types in flat object', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            const obj = {
                str: 'hello',
                num: 42,
                bool: true,
                nul: null,
                undef: undefined,
                big: 123n,
            };

            await waitForValue(data(obj));
            await waitForValue(data(obj));

            expect(init).toHaveBeenCalledTimes(1);
        });
    });

    describe('tier 3: fallback to stableStringify', () => {
        it('falls back for nested objects', async () => {
            const init = vi.fn(async ({ user }: { user: { id: number; name: string } }) => user);
            const data = artifact(init);

            await waitForValue(data({ user: { id: 1, name: 'Alice' } }));
            await waitForValue(data({ user: { id: 1, name: 'Alice' } }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for Date objects', async () => {
            const init = vi.fn(async ({ date }: { date: Date }) => ({ date: date.toISOString() }));
            const data = artifact(init);

            const date = new Date('2024-01-01');
            await waitForValue(data({ date }));
            await waitForValue(data({ date: new Date('2024-01-01') }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for Map objects', async () => {
            const init = vi.fn(async ({ map }: { map: Map<string, number> }) => ({ size: map.size }));
            const data = artifact(init);

            const map = new Map([['a', 1]]);
            await waitForValue(data({ map }));
            await waitForValue(data({ map: new Map([['a', 1]]) }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for Set objects', async () => {
            const init = vi.fn(async ({ set }: { set: Set<number> }) => ({ size: set.size }));
            const data = artifact(init);

            const set = new Set([1, 2]);
            await waitForValue(data({ set }));
            await waitForValue(data({ set: new Set([1, 2]) }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for RegExp objects', async () => {
            const init = vi.fn(async ({ pattern }: { pattern: RegExp }) => ({ pattern: pattern.source }));
            const data = artifact(init);

            await waitForValue(data({ pattern: /test/i }));
            await waitForValue(data({ pattern: /test/i }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for arrays', async () => {
            const init = vi.fn(async ({ arr }: { arr: number[] }) => ({ len: arr.length }));
            const data = artifact(init);

            await waitForValue(data({ arr: [1, 2, 3] }));
            await waitForValue(data({ arr: [1, 2, 3] }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for objects with nested arrays', async () => {
            const init = vi.fn(async ({ items }: { items: number[] }) => ({ count: items.length }));
            const data = artifact(init);

            await waitForValue(data({ items: [1, 2] }));
            await waitForValue(data({ items: [1, 2] }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back for objects with nested objects', async () => {
            const init = vi.fn(async ({ config }: { config: { nested: { value: number } } }) => config);
            const data = artifact(init);

            await waitForValue(data({ config: { nested: { value: 42 } } }));
            await waitForValue(data({ config: { nested: { value: 42 } } }));

            expect(init).toHaveBeenCalledTimes(1);
        });
    });

    describe('collision prevention', () => {
        it('does not collide primitive "1" with object {a:1}', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data('1'));
            await waitForValue(data({ a: 1 }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide number 1 with string "1"', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(1));
            await waitForValue(data('1'));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {a:1} with {a:"1"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ a: 1 }));
            await waitForValue(data({ a: '1' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {a:null} with {a:"null"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ a: null }));
            await waitForValue(data({ a: 'null' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {a:true} with {a:"true"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ a: true }));
            await waitForValue(data({ a: 'true' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {a:undefined} with {a:"undefined"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ a: undefined }));
            await waitForValue(data({ a: 'undefined' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {a:"1,b:2"} with {a:"1",b:"2"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ a: '1,b:2' }));
            await waitForValue(data({ a: '1', b: '2' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object {"a:b":"c"} with {a:"b:c"}', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ 'a:b': 'c' }));
            await waitForValue(data({ a: 'b:c' }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object with nested object', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ id: 1 }));
            await waitForValue(data({ id: { value: 1 } }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide flat object with array', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data({ id: 1 }));
            await waitForValue(data([1]));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide primitive with Date', async () => {
            const init = vi.fn(async (params: any) => params);
            const data = artifact(init);

            await waitForValue(data('2024-01-01T00:00:00.000Z'));
            await waitForValue(data(new Date('2024-01-01')));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('does not collide false with 0 or empty string', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(false));
            await waitForValue(data(0));
            await waitForValue(data(''));

            expect(init).toHaveBeenCalledTimes(3);
        });

        it('does not collide null with undefined', async () => {
            const init = vi.fn(async (params: any) => ({ value: params }));
            const data = artifact(init);

            await waitForValue(data(null));
            await waitForValue(data(undefined));

            expect(init).toHaveBeenCalledTimes(2);
        });
    });

    describe('custom key option still works', () => {
        it('custom key overrides tiered default key', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const data = artifact(init, {
                key: ({ id }: { id: number }) => `custom:${id}`,
            });

            await waitForValue(data({ id: 1 }));
            await waitForValue(data({ id: 1 }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('custom key with different logic produces different instances', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const data = artifact(init, {
                key: () => 'always-same',
            });

            await waitForValue(data({ id: 1 }));
            await waitForValue(data({ id: 2 }));

            expect(init).toHaveBeenCalledTimes(1);
        });
    });

    describe('maxEntries works with tiered keys', () => {
        it('evicts LRU instances with primitive keys', async () => {
            const init = vi.fn(async (params: any) => ({ id: params }));
            const data = artifact(init, { maxEntries: 2 });

            await waitForValue(data(1));
            await waitForValue(data(2));
            await waitForValue(data(3));

            expect(init).toHaveBeenCalledTimes(3);

            await waitForValue(data(1));
            expect(init).toHaveBeenCalledTimes(4);
        });

        it('evicts LRU instances with flat object keys', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const data = artifact(init, { maxEntries: 2 });

            await waitForValue(data({ id: 1 }));
            await waitForValue(data({ id: 2 }));
            await waitForValue(data({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            await waitForValue(data({ id: 1 }));
            expect(init).toHaveBeenCalledTimes(4);
        });

        it('evicts LRU instances with stableStringify keys', async () => {
            const init = vi.fn(async ({ user }: { user: { id: number } }) => user);
            const data = artifact(init, { maxEntries: 2 });

            await waitForValue(data({ user: { id: 1 } }));
            await waitForValue(data({ user: { id: 2 } }));
            await waitForValue(data({ user: { id: 3 } }));

            expect(init).toHaveBeenCalledTimes(3);

            await waitForValue(data({ user: { id: 1 } }));
            expect(init).toHaveBeenCalledTimes(4);
        });
    });

    describe('structural equality preserved', () => {
        it('maintains structural equality for nested objects with sorted keys', async () => {
            const init = vi.fn(async ({ a, b }: { a: { x: number }; b: { y: number } }) => ({ a, b }));
            const data = artifact(init);

            await waitForValue(data({ a: { x: 1 }, b: { y: 2 } }));
            await waitForValue(data({ b: { y: 2 }, a: { x: 1 } }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('maintains structural equality for arrays', async () => {
            const init = vi.fn(async ({ items }: { items: number[] }) => items);
            const data = artifact(init);

            await waitForValue(data({ items: [1, 2, 3] }));
            await waitForValue(data({ items: [1, 2, 3] }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('distinguishes different array contents', async () => {
            const init = vi.fn(async ({ items }: { items: number[] }) => items);
            const data = artifact(init);

            await waitForValue(data({ items: [1, 2, 3] }));
            await waitForValue(data({ items: [1, 2, 4] }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('distinguishes different array orders', async () => {
            const init = vi.fn(async ({ items }: { items: number[] }) => items);
            const data = artifact(init);

            await waitForValue(data({ items: [1, 2, 3] }));
            await waitForValue(data({ items: [3, 2, 1] }));

            expect(init).toHaveBeenCalledTimes(2);
        });
    });
});
