import { describe, expect, it, vi } from 'vitest';
import {
    artifact,
    readArtifact,
    resetArtifact,
    resolveArtifact,
    writeArtifact,
} from '../src/index';
import { waitForValue } from './wait';

describe('async artifacts', () => {
    it('runs a function initializer lazily on first read', async () => {
        const init = vi.fn(async () => 'ready');
        const ref = artifact(init);

        expect(init).not.toHaveBeenCalled();

        const value = await waitForValue(ref);
        expect(value).toBe('ready');
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('starts a bare promise immediately on creation', async () => {
        let resolve!: (value: string) => void;
        const promise = new Promise<string>((r) => {
            resolve = r;
        });

        const ref = artifact(promise);
        expect(readArtifact(ref)).toBeUndefined();

        resolve('immediate');
        await expect(waitForValue(ref)).resolves.toBe('immediate');
    });

    it('returns the resolved value after the promise settles', async () => {
        const ref = artifact(async () => ({ id: 1, name: 'Ada' }));
        await expect(waitForValue(ref)).resolves.toEqual({ id: 1, name: 'Ada' });
        expect(readArtifact(ref)).toEqual({ id: 1, name: 'Ada' });
    });

    it('throws from readArtifact when the initializer rejects', async () => {
        const error = new Error('fetch failed');
        const ref = artifact(async () => {
            throw error;
        });

        await expect(waitForValue(ref)).rejects.toThrow('fetch failed');
        expect(() => readArtifact(ref)).toThrow('fetch failed');
    });

    it('re-runs the function initializer on reset', async () => {
        let n = 0;
        const ref = artifact(async () => ++n);

        await expect(waitForValue(ref)).resolves.toBe(1);

        const next = waitForValue(ref, (v) => v === 2);
        resetArtifact(ref);
        await expect(next).resolves.toBe(2);
    });

    it('can overwrite an async artifact with a sync write', async () => {
        const ref = artifact(async () => 'from-server');
        await waitForValue(ref);

        writeArtifact(ref, 'local');
        expect(readArtifact(ref)).toBe('local');
    });
});

describe('resolveArtifact', () => {
    it('returns the resolved value for an async artifact', async () => {
        const ref = artifact(async () => ({ id: 1, name: 'Ada' }));
        await expect(resolveArtifact(ref)).resolves.toEqual({ id: 1, name: 'Ada' });
    });

    it('resolves immediately from cache without re-running the initializer', async () => {
        const init = vi.fn(async () => 'ready');
        const ref = artifact(init);

        await expect(resolveArtifact(ref)).resolves.toBe('ready');
        await expect(resolveArtifact(ref)).resolves.toBe('ready');
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('rejects when the initializer rejects', async () => {
        const error = new Error('fetch failed');
        const ref = artifact(async () => {
            throw error;
        });

        await expect(resolveArtifact(ref)).rejects.toThrow('fetch failed');
        await expect(resolveArtifact(ref)).rejects.toThrow('fetch failed');
    });

    it('resolves a legitimate undefined value without treating it as pending', async () => {
        const ref = artifact(undefined as undefined);
        await expect(resolveArtifact(ref)).resolves.toBeUndefined();
    });

    it('works with parameterized artifacts', async () => {
        const user = artifact(async ({ id }: { id: number }) => ({ id, name: `User ${id}` }));

        await expect(resolveArtifact(user({ id: 1 }))).resolves.toEqual({ id: 1, name: 'User 1' });
        await expect(resolveArtifact(user({ id: 2 }))).resolves.toEqual({ id: 2, name: 'User 2' });
        await expect(resolveArtifact(user({ id: 1 }))).resolves.toEqual({ id: 1, name: 'User 1' });
    });
});
