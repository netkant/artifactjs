import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    artifact,
    readArtifact,
    resolveArtifact,
    subscribeArtifact,
} from '../src/index';
import { waitForValue } from './wait';

describe('readArtifact during revalidation', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('readArtifact returns stale value during on-read revalidation while resolveArtifact waits', async () => {
        let n = 0;
        const init = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return ++n;
        });
        const ref = artifact(init, { maxAge: 1_000 });

        // Initial load
        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);
        expect(init).toHaveBeenCalledTimes(1);

        // Expire the value
        await vi.advanceTimersByTimeAsync(1_001);

        // Trigger revalidation by reading (on-read mode)
        const staleValue = readArtifact(ref);
        
        // readArtifact returns the stale value immediately (sync peek)
        expect(staleValue).toBe(1);
        
        // But the revalidation has started, so init was called again
        expect(init).toHaveBeenCalledTimes(2);

        // resolveArtifact waits for the new value
        const freshPromise = resolveArtifact(ref);
        await vi.advanceTimersByTimeAsync(100);
        await expect(freshPromise).resolves.toBe(2);
        
        // After revalidation completes, readArtifact returns the fresh value
        expect(readArtifact(ref)).toBe(2);
    });

    it('readArtifact returns stale value during auto-revalidation while subscribed', async () => {
        let n = 0;
        const init = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return ++n;
        });
        const ref = artifact(init, { maxAge: 500, revalidate: 'auto' });

        // Subscribe to trigger auto-revalidate
        const listener = vi.fn();
        subscribeArtifact(ref, listener);

        // Initial load
        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);
        expect(init).toHaveBeenCalledTimes(1);

        // Auto-revalidation kicks off after maxAge
        await vi.advanceTimersByTimeAsync(500);
        
        // During revalidation, readArtifact still returns the stale value (sync peek)
        expect(readArtifact(ref)).toBe(1);
        
        // Revalidation is in progress
        expect(init).toHaveBeenCalledTimes(2);

        // Wait for revalidation to complete
        await vi.advanceTimersByTimeAsync(100);
        await waitForValue(ref, (v) => v === 2);
        
        // Now readArtifact returns the fresh value
        expect(readArtifact(ref)).toBe(2);
        expect(listener).toHaveBeenCalled();
    });

    it('readArtifact returns stale value during revalidation (stale-while-revalidate)', async () => {
        let n = 0;
        const init = vi.fn(async () => ++n);
        const ref = artifact(init, { maxAge: 100 });

        // Initial load
        await waitForValue(ref);
        expect(readArtifact(ref)).toBe(1);

        // Expire and trigger revalidation
        await vi.advanceTimersByTimeAsync(101);
        readArtifact(ref); // Trigger on-read revalidation
        
        // readArtifact provides stale value for imperative code (does not suspend)
        expect(readArtifact(ref)).toBe(1);
        
        // This is the documented stale-while-revalidate behavior for imperative reads.
        // React hooks would suspend instead during revalidation.
        
        // Wait for fresh value
        await waitForValue(ref, (v) => v === 2);
        expect(readArtifact(ref)).toBe(2);
    });
});
