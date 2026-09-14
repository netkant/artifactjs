import { describe, expect, it, vi } from 'vitest';
import { artifact, readArtifact, writeArtifact } from '../src/index';
import { waitForValue } from './wait';

describe('parameterized artifacts', () => {
    it('keeps different params as independent instances', async () => {
        const user = artifact(async ({ id }: { id: number }) => ({ id, name: `User ${id}` }));

        const a = await waitForValue(user({ id: 1 }));
        const b = await waitForValue(user({ id: 2 }));

        expect(a).toEqual({ id: 1, name: 'User 1' });
        expect(b).toEqual({ id: 2, name: 'User 2' });
    });

    it('shares a cached value for the same params', async () => {
        const init = vi.fn(async ({ id }: { id: number }) => ({ id }));
        const user = artifact(init);

        const first = await waitForValue(user({ id: 1 }));
        const second = await waitForValue(user({ id: 1 }));

        expect(first).toEqual(second);
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('uses the same default key for factory and factory()', () => {
        const counter = artifact(({ get: _get }) => 0);

        writeArtifact(counter, 5);
        expect(readArtifact(counter())).toBe(5);

        writeArtifact(counter(), 10);
        expect(readArtifact(counter)).toBe(10);
    });
});
