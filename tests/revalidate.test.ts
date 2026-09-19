import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    artifact,
    readArtifact,
    subscribeArtifact,
    writeArtifact,
} from '../src/index';
import { waitForValue } from './wait';

describe('cache freshness (maxAge / revalidate)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('never expires when maxAge is non-finite (default)', async () => {
        const init = vi.fn(async () => 'fresh');
        const ref = artifact(init);

        await waitForValue(ref);
        expect(init).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(readArtifact(ref)).toBe('fresh');
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('hard-refreshes on next read after maxAge with on-read (default mode)', async () => {
        let n = 0;
        const init = vi.fn(async () => ++n);
        const ref = artifact(init, { maxAge: 1_000 });

        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);
        expect(init).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1_001);

        const next = waitForValue(ref, (v) => v === 2);
        readArtifact(ref); // expired — triggers on-read revalidate
        await expect(next).resolves.toBe(2);
        expect(init).toHaveBeenCalledTimes(2);
    });

    it('auto-revalidates on a timer while subscribed', async () => {
        let n = 0;
        const init = vi.fn(async () => ++n);
        const ref = artifact(init, { maxAge: 500, revalidate: 'auto' });

        const listener = vi.fn();
        subscribeArtifact(ref, listener);

        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);
        expect(init).toHaveBeenCalledTimes(1);

        const next = waitForValue(ref, (v) => v === 2);
        await vi.advanceTimersByTimeAsync(500);
        await expect(next).resolves.toBe(2);
        expect(init).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalled();
    });

    it('does not schedule auto-revalidate when there are no listeners', async () => {
        let n = 0;
        const init = vi.fn(async () => ++n);
        const ref = artifact(init, { maxAge: 500, revalidate: 'auto' });

        await waitForValue(ref);
        expect(init).toHaveBeenCalledTimes(1);

        // Advance past maxAge without subscribers — timer path must not fire.
        // Do not call readArtifact here (that would trigger on-read refresh).
        await vi.advanceTimersByTimeAsync(2_000);
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('does not treat a pending state as expired', async () => {
        let resolve!: (value: string) => void;
        const init = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolve = r;
                }),
        );
        const ref = artifact(init, { maxAge: 100 });

        readArtifact(ref);
        expect(init).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(500);
        readArtifact(ref);
        expect(init).toHaveBeenCalledTimes(1);

        resolve('done');
        await expect(waitForValue(ref)).resolves.toBe('done');
    });

    it('ignores stale revalidation when new value is written during refresh', async () => {
        let resolveFirst!: (value: number) => void;
        let resolveSecond!: (value: number) => void;
        let callCount = 0;

        const init = vi.fn(() => {
            callCount++;
            if (callCount === 1) {
                return new Promise<number>((r) => {
                    resolveFirst = r;
                });
            }
            return new Promise<number>((r) => {
                resolveSecond = r;
            });
        });

        const ref = artifact(init, { maxAge: 1_000, revalidate: 'auto' });
        const listener = vi.fn();
        subscribeArtifact(ref, listener);

        readArtifact(ref);
        expect(callCount).toBe(1);

        resolveFirst(1);
        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(callCount).toBe(2);

        writeArtifact(ref, 99);
        expect(readArtifact(ref)).toBe(99);

        resolveSecond(2);
        await vi.advanceTimersByTimeAsync(100);
        expect(readArtifact(ref)).toBe(99);
    });
});
