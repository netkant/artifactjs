import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    artifactWithStorage,
    readArtifact,
    writeArtifact,
} from '../src/index';

const keys: string[] = [];

function uniqueKey(prefix: string): string {
    const key = `${prefix}-${Math.random().toString(36).slice(2)}`;
    keys.push(key);
    return key;
}

afterEach(() => {
    for (const key of keys) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
    keys.length = 0;
});

describe('artifactWithStorage', () => {
    it('uses the fallback when the key is missing', () => {
        const key = uniqueKey('theme');
        const ref = artifactWithStorage(key, 'light');
        expect(readArtifact(ref)).toBe('light');
    });

    it('uses undefined when initial value is omitted and key is missing', () => {
        const key = uniqueKey('token');
        const ref = artifactWithStorage<string | undefined>(key);
        expect(readArtifact(ref)).toBeUndefined();
    });

    it('deserializes an existing key on create', () => {
        const key = uniqueKey('theme');
        localStorage.setItem(key, JSON.stringify('dark'));
        const ref = artifactWithStorage(key, 'light');
        expect(readArtifact(ref)).toBe('dark');
    });

    it('persists writes via setItem', () => {
        const key = uniqueKey('theme');
        const ref = artifactWithStorage(key, 'light');
        writeArtifact(ref, 'dark');
        expect(localStorage.getItem(key)).toBe(JSON.stringify('dark'));
        expect(readArtifact(ref)).toBe('dark');
    });

    it('supports custom serialize / deserialize (Set)', () => {
        const key = uniqueKey('tags');
        const ref = artifactWithStorage(key, new Set<string>(), {
            serialize: (v) => JSON.stringify([...v]),
            deserialize: (v) => new Set(JSON.parse(v) as string[]),
        });

        writeArtifact(ref, new Set(['a', 'b']));
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['a', 'b']);

        const again = artifactWithStorage(key, new Set<string>(), {
            serialize: (v) => JSON.stringify([...v]),
            deserialize: (v) => new Set(JSON.parse(v) as string[]),
        });
        expect([...readArtifact(again)!]).toEqual(['a', 'b']);
    });

    it('can use sessionStorage', () => {
        const key = uniqueKey('draft');
        const ref = artifactWithStorage(key, '', {
            storage: () => sessionStorage,
        });
        writeArtifact(ref, 'hello');
        expect(sessionStorage.getItem(key)).toBe(JSON.stringify('hello'));
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('updates from a storage event on the same key and area', () => {
        const key = uniqueKey('theme');
        const ref = artifactWithStorage(key, 'light');

        const event = new StorageEvent('storage', {
            key,
            newValue: JSON.stringify('dark'),
            storageArea: localStorage,
        });
        window.dispatchEvent(event);

        expect(readArtifact(ref)).toBe('dark');
    });

    it('ignores storage events for other keys or areas', () => {
        const key = uniqueKey('theme');
        const ref = artifactWithStorage(key, 'light');

        window.dispatchEvent(
            new StorageEvent('storage', {
                key: 'other-key',
                newValue: JSON.stringify('dark'),
                storageArea: localStorage,
            }),
        );
        expect(readArtifact(ref)).toBe('light');

        window.dispatchEvent(
            new StorageEvent('storage', {
                key,
                newValue: JSON.stringify('dark'),
                storageArea: sessionStorage,
            }),
        );
        expect(readArtifact(ref)).toBe('light');
    });

    it('falls back when getItem throws', () => {
        const key = uniqueKey('broken-read');
        const storage = {
            getItem: () => {
                throw new Error('unavailable');
            },
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            length: 0,
        } satisfies Storage;

        const ref = artifactWithStorage(key, 'fallback', {
            storage: () => storage,
        });
        expect(readArtifact(ref)).toBe('fallback');
    });

    it('swallows setItem errors on write', () => {
        const key = uniqueKey('broken-write');
        const storage = {
            getItem: () => null,
            setItem: () => {
                throw new Error('quota exceeded');
            },
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            length: 0,
        } satisfies Storage;

        const ref = artifactWithStorage(key, 'ok', {
            storage: () => storage,
        });
        expect(() => writeArtifact(ref, 'new')).not.toThrow();
        expect(readArtifact(ref)).toBe('new');
    });

    it('resumes persistence after a storage event throws during deserialization', () => {
        const key = uniqueKey('event-throw');
        let deserializeCallCount = 0;

        // Initialize with a valid value
        localStorage.setItem(key, JSON.stringify('initial'));

        const ref = artifactWithStorage(key, 'fallback', {
            deserialize: (v: string) => {
                deserializeCallCount++;
                // Throw only on the second call (triggered by storage event)
                if (deserializeCallCount === 2) {
                    throw new Error('deserialize error');
                }
                return JSON.parse(v) as string;
            },
        });

        // First read should work
        expect(readArtifact(ref)).toBe('initial');

        // Trigger a storage event that will throw during deserialize
        window.dispatchEvent(
            new StorageEvent('storage', {
                key,
                newValue: JSON.stringify('from-event'),
                storageArea: localStorage,
            }),
        );

        // The error should be caught and the syncing flag should be reset via finally
        // Verify that normal writes still persist after the error
        writeArtifact(ref, 'after-error');
        expect(localStorage.getItem(key)).toBe(JSON.stringify('after-error'));
        expect(readArtifact(ref)).toBe('after-error');
    });
});
