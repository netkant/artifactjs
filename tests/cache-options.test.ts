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
            const user = artifact(init);

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
        it('static artifacts ignore cache options', () => {
            const counter = artifact(0, { maxEntries: 1 });

            writeArtifact(counter, 5);
            expect(readArtifact(counter)).toBe(5);
        });
    });
});
