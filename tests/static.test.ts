import { describe, expect, it, vi } from 'vitest';
import {
    artifact,
    readArtifact,
    resetArtifact,
    subscribeArtifact,
    writeArtifact,
} from '../src/index';

describe('static artifacts', () => {
    it('reads numbers, strings, objects, and arrays', () => {
        expect(readArtifact(artifact(0))).toBe(0);
        expect(readArtifact(artifact('Alice'))).toBe('Alice');
        expect(readArtifact(artifact({ theme: 'dark' }))).toEqual({ theme: 'dark' });
        expect(readArtifact(artifact(['react', 'ts']))).toEqual(['react', 'ts']);
    });

    it('writes a new value', () => {
        const count = artifact(0);
        writeArtifact(count, 42);
        expect(readArtifact(count)).toBe(42);
    });

    it('writes with an updater function', () => {
        const count = artifact(10);
        writeArtifact(count, (n) => (n ?? 0) + 1);
        expect(readArtifact(count)).toBe(11);
    });

    it('resets to the initial value', () => {
        const count = artifact(0);
        writeArtifact(count, 99);
        resetArtifact(count);
        expect(readArtifact(count)).toBe(0);
    });

    it('notifies subscribers on write and stops after unsubscribe', () => {
        const count = artifact(0);
        const listener = vi.fn();
        const unsub = subscribeArtifact(count, listener);

        writeArtifact(count, 1);
        expect(listener).toHaveBeenCalledTimes(1);

        unsub();
        writeArtifact(count, 2);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(readArtifact(count)).toBe(2);
    });


    it('does not notify when writing the same primitive value', () => {
        const count = artifact(0);
        const listener = vi.fn();
        subscribeArtifact(count, listener);

        writeArtifact(count, 0);
        expect(listener).not.toHaveBeenCalled();
        expect(readArtifact(count)).toBe(0);
    });

    it('does not notify when resetting a static artifact already at its initial value', () => {
        const count = artifact(0);
        const listener = vi.fn();
        subscribeArtifact(count, listener);

        resetArtifact(count);
        expect(listener).not.toHaveBeenCalled();
        expect(readArtifact(count)).toBe(0);
    });

    it('throws when given a non-artifact reference', () => {
        expect(() => readArtifact({} as never)).toThrow(
            'Expected an artifact reference. Pass artifact(...) or artifactFactory(...args).',
        );
    });
});
