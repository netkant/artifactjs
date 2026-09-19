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

    it('does not notify derived when source Object.is is unchanged', () => {
        const list: Todo[] = [{ id: 1, completed: false }];
        const todos = artifact(list);
        const completed = artifact(({ get }) => get(todos).filter((t) => t.completed));

        const listener = vi.fn();
        subscribeArtifact(completed, listener);
        expect(readArtifact(completed)).toEqual([]);
        listener.mockClear();

        writeArtifact(todos, list);
        expect(listener).not.toHaveBeenCalled();
    });

    it('does not notify derived when a new source value yields the same derived result', () => {
        const todos = artifact<Todo[]>([
            { id: 1, completed: false },
            { id: 2, completed: true },
        ]);
        const completedCount = artifact(({ get }) => get(todos).filter((t) => t.completed).length);

        const listener = vi.fn();
        subscribeArtifact(completedCount, listener);
        expect(readArtifact(completedCount)).toBe(1);
        listener.mockClear();

        writeArtifact(todos, [
            { id: 1, completed: false },
            { id: 2, completed: true },
            { id: 3, completed: false },
        ]);
        expect(readArtifact(completedCount)).toBe(1);
        expect(listener).not.toHaveBeenCalled();
    });

    it('rejects sync error in recompute even when old Promise resolves later', async () => {
        let resolveSlowPromise: (value: number) => void;
        const slowPromise = new Promise<number>((resolve) => {
            resolveSlowPromise = resolve;
        });

        const source = artifact(0);
        const derived = artifact(({ get }) => {
            const val = get(source);
            if (val === 0) {
                return slowPromise;
            }
            throw new Error('sync error');
        });

        const initialRead = readArtifact(derived);
        expect(initialRead).toBeUndefined();

        writeArtifact(source, 1);

        expect(() => readArtifact(derived)).toThrow('sync error');

        resolveSlowPromise!(42);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(() => readArtifact(derived)).toThrow('sync error');
    });

});
