import { describe, expect, it, vi } from 'vitest';
import { artifact, readArtifact, subscribeArtifact, writeArtifact } from '../src/index';
import { waitForValue } from './wait';

describe('parameterized cache options', () => {
    describe('custom key function', () => {
        it('uses custom key function to cache instances', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id, name: `User ${id}` }));
            const user = artifact(init, {
                key: ({ id }: { id: number }) => `user:${id}`,
            });

            const first = await waitForValue(user({ id: 1 }));
            const second = await waitForValue(user({ id: 1 }));

            expect(first).toBe(second);
            expect(init).toHaveBeenCalledTimes(1);
        });

        it('returns same instance for same custom key', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, {
                key: () => 'always-same',
            });

            await waitForValue(user({ id: 1 }));
            await waitForValue(user({ id: 2 }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('falls back to default key when no custom key provided', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init);

            const first = await waitForValue(user({ id: 1 }));
            const second = await waitForValue(user({ id: 2 }));

            expect(first).not.toBe(second);
            expect(init).toHaveBeenCalledTimes(2);
        });

        it('throws when custom key is set but params are not a plain object', async () => {
            const user = artifact(
                (arg: any) => Promise.resolve({ value: arg }),
                { key: (params: any) => `key:${params}` },
            );

            expect(() => user(123)).toThrow('Custom key function requires params to be a plain object');
        });
    });

    describe('default key stability', () => {
        it('uses deterministic stringify with sorted object keys', async () => {
            const init = vi.fn(async ({ a, b }: { a: number; b: number }) => ({ a, b }));
            const data = artifact(init);

            await waitForValue(data({ a: 1, b: 2 }));
            await waitForValue(data({ b: 2, a: 1 }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('handles nested objects with sorted keys', async () => {
            const init = vi.fn(async ({ user }: { user: { id: number; name: string } }) => user);
            const data = artifact(init);

            await waitForValue(data({ user: { id: 1, name: 'Alice' } }));
            await waitForValue(data({ user: { name: 'Alice', id: 1 } }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('distinguishes different parameter values', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init);

            const first = await waitForValue(user({ id: 1 }));
            const second = await waitForValue(user({ id: 2 }));

            expect(first).not.toBe(second);
            expect(init).toHaveBeenCalledTimes(2);
        });

        it('distinguishes different Date parameters', async () => {
            const init = vi.fn(async ({ date }: { date: Date }) => ({ date: date.toISOString() }));
            const data = artifact(init);

            const date1 = new Date('2024-01-01');
            const date2 = new Date('2024-01-02');

            await waitForValue(data({ date: date1 }));
            await waitForValue(data({ date: date2 }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('treats same Date values as identical', async () => {
            const init = vi.fn(async ({ date }: { date: Date }) => ({ date: date.toISOString() }));
            const data = artifact(init);

            const date1 = new Date('2024-01-01');
            const date2 = new Date('2024-01-01');

            await waitForValue(data({ date: date1 }));
            await waitForValue(data({ date: date2 }));

            expect(init).toHaveBeenCalledTimes(1);
        });

        it('distinguishes different RegExp parameters', async () => {
            const init = vi.fn(async ({ pattern }: { pattern: RegExp }) => ({ pattern: pattern.source }));
            const data = artifact(init);

            await waitForValue(data({ pattern: /test/ }));
            await waitForValue(data({ pattern: /other/ }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('distinguishes different Map parameters', async () => {
            const init = vi.fn(async ({ map }: { map: Map<string, number> }) => ({ size: map.size }));
            const data = artifact(init);

            const map1 = new Map([['a', 1]]);
            const map2 = new Map([['b', 2]]);

            await waitForValue(data({ map: map1 }));
            await waitForValue(data({ map: map2 }));

            expect(init).toHaveBeenCalledTimes(2);
        });

        it('distinguishes different Set parameters', async () => {
            const init = vi.fn(async ({ set }: { set: Set<number> }) => ({ size: set.size }));
            const data = artifact(init);

            const set1 = new Set([1, 2]);
            const set2 = new Set([3, 4]);

            await waitForValue(data({ set: set1 }));
            await waitForValue(data({ set: set2 }));

            expect(init).toHaveBeenCalledTimes(2);
        });
    });

    describe('maxEntries LRU eviction', () => {
        it('evicts least recently used unsubscribed instances when exceeding maxEntries', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: 2 });

            await waitForValue(user({ id: 1 }));
            await waitForValue(user({ id: 2 }));
            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            const shouldRefetch = await waitForValue(user({ id: 1 }));
            expect(shouldRefetch).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(4);
        });

        it('does not evict subscribed instances', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: 2 });

            const ref1 = user({ id: 1 });
            await waitForValue(ref1);

            const unsub = subscribeArtifact(ref1, () => {});

            await waitForValue(user({ id: 2 }));
            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            const shouldBeCached = readArtifact(ref1);
            expect(shouldBeCached).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(3);

            unsub();
        });

        it('updates LRU on read access', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: 2 });

            await waitForValue(user({ id: 1 }));
            await waitForValue(user({ id: 2 }));

            readArtifact(user({ id: 1 }));

            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            const shouldBeCached = readArtifact(user({ id: 1 }));
            expect(shouldBeCached).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(3);

            const shouldBeEvicted = await waitForValue(user({ id: 2 }));
            expect(shouldBeEvicted).toEqual({ id: 2 });
            expect(init).toHaveBeenCalledTimes(4);
        });

        it('updates LRU on subscribe', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: 2 });

            const ref1 = user({ id: 1 });
            await waitForValue(ref1);
            await waitForValue(user({ id: 2 }));

            const unsub = subscribeArtifact(ref1, () => {});
            unsub();

            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            const shouldBeCached = readArtifact(ref1);
            expect(shouldBeCached).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(3);
        });

        it('allows unlimited entries when maxEntries is Infinity', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: Infinity });

            for (let i = 1; i <= 100; i++) {
                await waitForValue(user({ id: i }));
            }

            expect(init).toHaveBeenCalledTimes(100);

            for (let i = 1; i <= 100; i++) {
                const cached = readArtifact(user({ id: i }));
                expect(cached).toEqual({ id: i });
            }

            expect(init).toHaveBeenCalledTimes(100);
        });

        it('allows unlimited entries when maxEntries is false', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: false });

            for (let i = 1; i <= 100; i++) {
                await waitForValue(user({ id: i }));
            }

            expect(init).toHaveBeenCalledTimes(100);

            for (let i = 1; i <= 100; i++) {
                const cached = readArtifact(user({ id: i }));
                expect(cached).toEqual({ id: i });
            }

            expect(init).toHaveBeenCalledTimes(100);
        });

        it('defaults to maxEntries of 500 for parameterized artifacts', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init);

            for (let i = 1; i <= 501; i++) {
                await waitForValue(user({ id: i }));
            }

            expect(init).toHaveBeenCalledTimes(501);

            const shouldBeEvicted = await waitForValue(user({ id: 1 }));
            expect(shouldBeEvicted).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(502);

            const shouldBeCached = readArtifact(user({ id: 501 }));
            expect(shouldBeCached).toEqual({ id: 501 });
            expect(init).toHaveBeenCalledTimes(502);
        });

        it('does not evict when all instances are subscribed', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, { maxEntries: 2 });

            const ref1 = user({ id: 1 });
            const ref2 = user({ id: 2 });

            await waitForValue(ref1);
            await waitForValue(ref2);

            const unsub1 = subscribeArtifact(ref1, () => {});
            const unsub2 = subscribeArtifact(ref2, () => {});

            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            expect(readArtifact(ref1)).toEqual({ id: 1 });
            expect(readArtifact(ref2)).toEqual({ id: 2 });

            expect(init).toHaveBeenCalledTimes(3);

            unsub1();
            unsub2();
        });

        it('does not evict pending instances', async () => {
            let resolveId1: ((value: { id: number }) => void) | undefined;
            const promise1 = new Promise<{ id: number }>((resolve) => {
                resolveId1 = resolve;
            });

            const init = vi.fn(async ({ id }: { id: number }) => {
                if (id === 1) return promise1;
                return { id };
            });

            const user = artifact(init, { maxEntries: 2 });

            const ref1 = user({ id: 1 });
            waitForValue(ref1);

            await waitForValue(user({ id: 2 }));
            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            resolveId1!({ id: 1 });
            await waitForValue(ref1);

            expect(readArtifact(ref1)).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(3);
        });

        it('treats invalid maxEntries as Infinity', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            
            const user1 = artifact(init, { maxEntries: 0 });
            const user2 = artifact(init, { maxEntries: -10 });
            const user3 = artifact(init, { maxEntries: NaN });

            for (let i = 1; i <= 100; i++) {
                await waitForValue(user1({ id: i }));
            }

            expect(init).toHaveBeenCalledTimes(100);

            for (let i = 1; i <= 100; i++) {
                const cached = readArtifact(user1({ id: i }));
                expect(cached).toEqual({ id: i });
            }

            expect(init).toHaveBeenCalledTimes(100);
        });
    });

    describe('combined key and maxEntries', () => {
        it('uses custom key for LRU tracking', async () => {
            const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
            const user = artifact(init, {
                key: ({ id }: { id: number }) => `user:${id}`,
                maxEntries: 2,
            });

            await waitForValue(user({ id: 1 }));
            await waitForValue(user({ id: 2 }));
            await waitForValue(user({ id: 3 }));

            expect(init).toHaveBeenCalledTimes(3);

            const shouldRefetch = await waitForValue(user({ id: 1 }));
            expect(shouldRefetch).toEqual({ id: 1 });
            expect(init).toHaveBeenCalledTimes(4);
        });
    });

    describe('static artifacts not affected', () => {
        it('static artifacts have maxEntries: Infinity by default', () => {
            const counter = artifact(0);

            writeArtifact(counter, 5);
            expect(readArtifact(counter)).toBe(5);
        });

        it('static artifacts ignore maxEntries even if specified', () => {
            const counter = artifact(0, { maxEntries: 1 });

            writeArtifact(counter, 5);
            expect(readArtifact(counter)).toBe(5);
        });
    });
});
