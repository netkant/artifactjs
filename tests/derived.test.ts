import { describe, expect, it, vi } from 'vitest';
import {
    artifact,
    readArtifact,
    subscribeArtifact,
    writeArtifact,
} from '../src/index';
import { waitForValue } from './wait';

type Todo = { id: number; completed: boolean };

describe('derived artifacts', () => {
    it('computes from a static source', () => {
        const todos = artifact<Todo[]>([
            { id: 1, completed: true },
            { id: 2, completed: false },
        ]);

        const completed = artifact(({ get }) => get(todos).filter((t) => t.completed));

        expect(readArtifact(completed)).toEqual([{ id: 1, completed: true }]);
    });

    it('recomputes and notifies when the source changes', () => {
        const todos = artifact<Todo[]>([{ id: 1, completed: false }]);
        const completed = artifact(({ get }) => get(todos).filter((t) => t.completed));

        const listener = vi.fn();
        subscribeArtifact(completed, listener);

        expect(readArtifact(completed)).toEqual([]);

        writeArtifact(todos, [{ id: 1, completed: true }]);

        expect(readArtifact(completed)).toEqual([{ id: 1, completed: true }]);
        expect(listener).toHaveBeenCalled();
    });

    it('waits on pending deps then resolves', async () => {
        const todos = artifact(async (): Promise<Todo[]> => [
            { id: 1, completed: true },
            { id: 2, completed: false },
        ]);

        const completed = artifact(({ get }) => get(todos).filter((t) => t.completed));

        await expect(waitForValue(completed)).resolves.toEqual([{ id: 1, completed: true }]);
    });

    it('surfaces rejected dependency errors', async () => {
        const source = artifact(async () => {
            throw new Error('dep failed');
        });
        const derived = artifact(({ get }) => get(source));

        await expect(waitForValue(derived)).rejects.toThrow('dep failed');
        expect(() => readArtifact(derived)).toThrow('dep failed');
    });
});
