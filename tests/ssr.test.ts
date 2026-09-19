import { describe, it, expect } from 'vitest';
import { artifact, readArtifact, resolveArtifact } from '../src/index';

/**
 * SSR-oriented tests for artifact snapshot behavior.
 * 
 * These tests verify artifact behavior across different states using imperative APIs
 * (readArtifact, resolveArtifact). For full SSR/hydration testing with React hooks
 * and useSyncExternalStore, a real SSR environment would be needed.
 * 
 * Current implementation: both getSnapshot and getServerSnapshot use the same function,
 * ensuring consistent behavior (pending → throw promise, rejected → throw error, 
 * resolved → return value).
 */

describe('SSR snapshot behavior', () => {
    it('resolved artifacts: readArtifact returns value immediately', () => {
        const testArtifact = artifact(42);
        
        // Resolved artifacts return their value synchronously
        const value = readArtifact(testArtifact);
        expect(value).toBe(42);
        
        // In SSR context, both server and client snapshots would return 42
    });

    it('pending artifacts: readArtifact returns undefined (no sync value yet)', async () => {
        let resolvePromise: (value: string) => void;
        const promise = new Promise<string>((resolve) => {
            resolvePromise = resolve;
        });
        
        const asyncArtifact = artifact(() => promise);
        
        // Pending artifact has no sync value available
        const syncValue = readArtifact(asyncArtifact);
        expect(syncValue).toBeUndefined();
        
        // Note: In React hooks (useArtifactValue), both server and client would
        // throw the promise (suspend), ensuring consistent Suspense behavior
        
        // Resolve to clean up
        resolvePromise!('resolved');
        await promise;
    });

    it('rejected artifacts: readArtifact throws error', async () => {
        const error = new Error('Test error');
        const rejectedArtifact = artifact(() => Promise.reject(error));
        
        // Wait for rejection to settle
        await expect(resolveArtifact(rejectedArtifact)).rejects.toThrow('Test error');
        
        // Rejected artifacts throw when read
        expect(() => readArtifact(rejectedArtifact)).toThrow('Test error');
        
        // In SSR context, both server and client snapshots would throw this error
    });

    it('derived artifacts: consistent resolution when dependencies are resolved', () => {
        const baseArtifact = artifact(10);
        const derivedArtifact = artifact(({ get }) => {
            const base = get(baseArtifact);
            return base * 2;
        });
        
        // Derived artifact resolves immediately when dependencies are resolved
        expect(readArtifact(derivedArtifact)).toBe(20);
        
        // Both server and client would see the same derived value
    });

    it('time-dependent artifacts cause hydration mismatches (documented behavior)', () => {
        // This documents why time-dependent artifacts are problematic for SSR
        const timeArtifact = artifact(Date.now());
        
        const time1 = readArtifact(timeArtifact);
        
        // Server and client will have different timestamps
        // This will cause hydration mismatch warnings in React
        // (documented in README as something to avoid)
        
        expect(typeof time1).toBe('number');
    });

    it('static artifacts: same value on server and client', () => {
        const staticArtifact = artifact({ theme: 'dark', lang: 'en' });
        
        const value = readArtifact(staticArtifact);
        
        // Static values are identical on server and client
        expect(value).toEqual({ theme: 'dark', lang: 'en' });
        
        // Server and client snapshots return the same object reference
        // Hydration succeeds without warnings
    });
});
