import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    artifactWithStorage,
    readArtifact,
    resetArtifact,
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

    it('warns when the same storage key is used twice', () => {
        const key = uniqueKey('duplicate');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        artifactWithStorage(key, 'first');
        expect(warnSpy).not.toHaveBeenCalled();

        artifactWithStorage(key, 'second');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Duplicate storage key detected')
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(key)
        );

        warnSpy.mockRestore();
    });

    it('reset re-reads from storage instead of restoring create-time snapshot', () => {
        const key = uniqueKey('theme');
        localStorage.setItem(key, JSON.stringify('dark'));
        const ref = artifactWithStorage(key, 'light');
        expect(readArtifact(ref)).toBe('dark');

        writeArtifact(ref, 'blue');
        expect(readArtifact(ref)).toBe('blue');

        localStorage.setItem(key, JSON.stringify('green'));
        resetArtifact(ref);
        expect(readArtifact(ref)).toBe('green');
    });

    it('reset does not overwrite newer storage with stale create-time value', () => {
        const key = uniqueKey('counter');
        localStorage.setItem(key, JSON.stringify(10));
        const ref = artifactWithStorage(key, 0);
        expect(readArtifact(ref)).toBe(10);

        writeArtifact(ref, 20);
        expect(readArtifact(ref)).toBe(20);
        expect(localStorage.getItem(key)).toBe(JSON.stringify(20));

        localStorage.setItem(key, JSON.stringify(99));
        resetArtifact(ref);
        expect(readArtifact(ref)).toBe(99);
        expect(localStorage.getItem(key)).toBe(JSON.stringify(99));
    });

    it('reset picks up fallback when storage key is deleted externally', () => {
        const key = uniqueKey('optional');
        localStorage.setItem(key, JSON.stringify('exists'));
        const ref = artifactWithStorage(key, 'fallback');
        expect(readArtifact(ref)).toBe('exists');

        localStorage.removeItem(key);
        resetArtifact(ref);
        expect(readArtifact(ref)).toBe('fallback');
        
        // The fallback is written back to storage by the subscriber
        expect(localStorage.getItem(key)).toBe(JSON.stringify('fallback'));
    });

    it('resumes persistence after a storage event throws during deserialization', () => {
        const key = uniqueKey('event-throw');
        let deserializeCallCount = 0;

        localStorage.setItem(key, JSON.stringify('initial'));

        const ref = artifactWithStorage(key, 'fallback', {
            deserialize: (v: string) => {
                deserializeCallCount++;
                if (deserializeCallCount === 2) {
                    throw new Error('deserialize error');
                }
                return JSON.parse(v) as string;
            },
        });

        expect(readArtifact(ref)).toBe('initial');

        window.dispatchEvent(
            new StorageEvent('storage', {
                key,
                newValue: JSON.stringify('from-event'),
                storageArea: localStorage,
            }),
        );

        writeArtifact(ref, 'after-error');
        expect(localStorage.getItem(key)).toBe(JSON.stringify('after-error'));
        expect(readArtifact(ref)).toBe('after-error');
    });
});
