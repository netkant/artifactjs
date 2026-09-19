import type { Artifact } from '../src/index';
import { readArtifact, subscribeArtifact } from '../src/index';

/**
 * Wait until a pending artifact settles.
 * If `expect` is provided, keeps waiting until the resolved value matches
 * (useful after reset / revalidate when a stale value may still be readable).
 */
export function waitForValue<T>(ref: Artifact<T>, expect?: (value: T) => boolean): Promise<T> {
    const matches = (value: T | undefined): value is T => {
        if (value === undefined) {
            return false;
        }
        return expect ? expect(value) : true;
    };

    try {
        const current = readArtifact(ref);
        if (matches(current)) {
            return Promise.resolve(current);
        }
    } catch (error) {
        return Promise.reject(error);
    }

    return new Promise<T>((resolve, reject) => {
        const unsub = subscribeArtifact(ref, () => {
            try {
                const value = readArtifact(ref);
                if (matches(value)) {
                    unsub();
                    resolve(value);
                }
            } catch (error) {
                unsub();
                reject(error);
            }
        });

        // Kick off hydration if still pending
        try {
            const value = readArtifact(ref);
            if (matches(value)) {
                unsub();
                resolve(value);
            }
        } catch (error) {
            unsub();
            reject(error);
        }
    });
}
