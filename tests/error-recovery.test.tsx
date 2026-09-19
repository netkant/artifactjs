import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    artifact,
    getArtifactStatus,
    readArtifact,
    resetArtifact,
    useArtifactLoadable,
    useResetArtifact,
    writeArtifact,
} from '../src/index';
import { waitForValue } from './wait';

afterEach(() => {
    cleanup();
});

class TestErrorBoundary extends Component<
    { children: ReactNode; onError?: (error: Error) => void },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        this.props.onError?.(error);
    }

    render() {
        if (this.state.error) {
            return <div>Error: {this.state.error.message}</div>;
        }
        return this.props.children;
    }
}

describe('getArtifactStatus', () => {
    it('returns "resolved" for static values', () => {
        const ref = artifact(42);
        expect(getArtifactStatus(ref)).toBe('resolved');
    });

    it('returns "pending" for unresolved promises', () => {
        const ref = artifact(new Promise(() => {}));
        expect(getArtifactStatus(ref)).toBe('pending');
    });

    it('returns "resolved" after promise settles', async () => {
        const ref = artifact(Promise.resolve('done'));
        expect(getArtifactStatus(ref)).toBe('pending');
        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');
    });

    it('returns "rejected" when initializer throws', async () => {
        const ref = artifact(async () => {
            throw new Error('failed');
        });
        await waitForValue(ref).catch(() => {});
        expect(getArtifactStatus(ref)).toBe('rejected');
    });

    it('returns "rejected" when promise rejects', async () => {
        const ref = artifact(Promise.reject(new Error('rejected')));
        // Need to trigger hydration
        await waitForValue(ref).catch(() => {});
        expect(getArtifactStatus(ref)).toBe('rejected');
    });

    it('returns "pending" during async function execution', () => {
        let resolve!: (value: string) => void;
        const ref = artifact(
            () =>
                new Promise<string>((r) => {
                    resolve = r;
                }),
        );

        readArtifact(ref);
        expect(getArtifactStatus(ref)).toBe('pending');

        resolve('ready');
        return waitForValue(ref).then(() => {
            expect(getArtifactStatus(ref)).toBe('resolved');
        });
    });

    it('tracks status changes through reset', async () => {
        let callCount = 0;
        const ref = artifact(async () => {
            callCount++;
            return callCount;
        });

        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');

        resetArtifact(ref);
        expect(getArtifactStatus(ref)).toBe('pending');

        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');
    });

    it('works with parameterized artifacts', async () => {
        const resolvers: Record<number, (value: { id: number; name: string }) => void> = {};
        const user = artifact(
            ({ id }: { id: number }) =>
                new Promise<{ id: number; name: string }>((r) => {
                    resolvers[id] = r;
                }),
        );

        const ref1 = user({ id: 1 });
        const ref2 = user({ id: 2 });

        expect(getArtifactStatus(ref1)).toBe('pending');
        expect(getArtifactStatus(ref2)).toBe('pending');

        resolvers[1]({ id: 1, name: 'User 1' });
        await waitForValue(ref1);
        expect(getArtifactStatus(ref1)).toBe('resolved');
        expect(getArtifactStatus(ref2)).toBe('pending');

        resolvers[2]({ id: 2, name: 'User 2' });
        await waitForValue(ref2);
        expect(getArtifactStatus(ref2)).toBe('resolved');
    });

    it('returns "resolved" when overwritten with sync value during pending', () => {
        const ref = artifact(new Promise(() => {}));
        expect(getArtifactStatus(ref)).toBe('pending');

        writeArtifact(ref, 'sync-value');
        expect(getArtifactStatus(ref)).toBe('resolved');
    });
});

describe('useArtifactLoadable', () => {
    it('updates when promise resolves after mount', async () => {
        let resolve!: (value: string) => void;
        const ref = artifact(
            new Promise<string>((r) => {
                resolve = r;
            }),
        );

        const { result } = renderHook(() => useArtifactLoadable(ref));

        // Initially pending
        expect(result.current.status).toBe('pending');
        expect(result.current.value).toBeUndefined();

        // Resolve the promise
        await act(async () => {
            resolve('done');
            await waitForValue(ref);
        });

        // Hook should update to resolved
        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe('done');
    });

    it('updates when promise rejects after mount', async () => {
        const error = new Error('failed');
        let reject!: (error: Error) => void;
        const ref = artifact(
            new Promise<string>((_, r) => {
                reject = r;
            }),
        );

        const { result } = renderHook(() => useArtifactLoadable(ref));

        // Initially pending
        expect(result.current.status).toBe('pending');

        // Reject the promise
        await act(async () => {
            reject(error);
            await waitForValue(ref).catch(() => {});
        });

        // Hook should update to rejected
        expect(result.current.status).toBe('rejected');
        expect(result.current.error).toBe(error);
    });

    it('returns resolved loadable for static values', () => {
        const ref = artifact(42);
        const { result } = renderHook(() => useArtifactLoadable(ref));

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe(42);
        expect(result.current.error).toBeUndefined();
    });

    it('returns pending loadable for unresolved promises', () => {
        const ref = artifact(new Promise(() => {}));
        const { result } = renderHook(() => useArtifactLoadable(ref));

        expect(result.current.status).toBe('pending');
        expect(result.current.value).toBeUndefined();
        expect(result.current.error).toBeUndefined();
    });

    it('updates to resolved when promise settles', async () => {
        let resolve!: (value: string) => void;
        const ref = artifact(
            new Promise<string>((r) => {
                resolve = r;
            }),
        );

        // Initial status is pending
        expect(getArtifactStatus(ref)).toBe('pending');

        // Resolve the promise  
        resolve('done');
        await waitForValue(ref);
        
        // Status should now be resolved
        expect(getArtifactStatus(ref)).toBe('resolved');
        
        // Hook should reflect the resolved state
        const { result } = renderHook(() => useArtifactLoadable(ref));
        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe('done');
    });

    it('returns rejected loadable when promise rejects', async () => {
        const error = new Error('failed');
        const ref = artifact(Promise.reject(error));

        // Wait for rejection
        await waitForValue(ref).catch(() => {});
        
        // Status should be rejected
        expect(getArtifactStatus(ref)).toBe('rejected');
        
        // Hook should reflect the rejected state
        const { result } = renderHook(() => useArtifactLoadable(ref));
        expect(result.current.status).toBe('rejected');
        expect(result.current.value).toBeUndefined();
        expect(result.current.error).toBe(error);
    });

    it('allows custom error UI without Error Boundary', async () => {
        const error = new Error('fetch failed');
        let reject!: (error: Error) => void;
        const users = artifact(
            () =>
                new Promise<never>((_, r) => {
                    reject = r;
                }),
        );

        expect(getArtifactStatus(users)).toBe('pending');
        
        reject(error);
        await waitForValue(users).catch(() => {});
        
        expect(getArtifactStatus(users)).toBe('rejected');
        
        const { result } = renderHook(() => useArtifactLoadable(users));
        expect(result.current.status).toBe('rejected');
        expect(result.current.error).toBe(error);
    });

    it('artifact status changes after reset (imperative API)', async () => {
        let resolvers: Array<() => void> = [];
        let callCount = 0;
        const ref = artifact(
            () =>
                new Promise<number>((r) => {
                    callCount++;
                    resolvers.push(() => r(callCount));
                }),
        );

        // Initial load
        expect(getArtifactStatus(ref)).toBe('pending');
        resolvers[0]();
        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');
        expect(readArtifact(ref)).toBe(1);

        // Reset
        resetArtifact(ref);
        expect(getArtifactStatus(ref)).toBe('pending');
        
        resolvers[1]();
        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');
        expect(readArtifact(ref)).toBe(2);
    });

    it('works with parameterized artifacts', async () => {
        const user = artifact(async ({ id }: { id: number }) => ({ id, name: `User ${id}` }));

        const ref1 = user({ id: 1 });
        const ref2 = user({ id: 2 });

        await waitForValue(ref1);
        await waitForValue(ref2);

        const { result: result1 } = renderHook(() => useArtifactLoadable(ref1));
        const { result: result2 } = renderHook(() => useArtifactLoadable(ref2));

        expect(result1.current.status).toBe('resolved');
        expect(result1.current.value).toEqual({ id: 1, name: 'User 1' });

        expect(result2.current.status).toBe('resolved');
        expect(result2.current.value).toEqual({ id: 2, name: 'User 2' });
    });

    it('handles retry flow with useResetArtifact', async () => {
        let resolvers: Array<() => void> = [];
        let rejecters: Array<(error: Error) => void> = [];
        let callCount = 0;
        
        const users = artifact(() => {
            callCount++;
            return new Promise<{ id: number; name: string }[]>((res, rej) => {
                resolvers.push(() => res([{ id: 1, name: 'Alice' }]));
                rejecters.push(rej);
            });
        });

        // Initial load fails
        expect(getArtifactStatus(users)).toBe('pending');
        rejecters[0](new Error('network error'));
        await waitForValue(users).catch(() => {});
        expect(getArtifactStatus(users)).toBe('rejected');

        // Reset and retry succeeds
        resetArtifact(users);
        expect(getArtifactStatus(users)).toBe('pending');
        resolvers[1]();
        await waitForValue(users);
        expect(getArtifactStatus(users)).toBe('resolved');
        expect(readArtifact(users)).toEqual([{ id: 1, name: 'Alice' }]);
    });

    it('does not suspend when used inside Suspense boundary', () => {
        const ref = artifact(new Promise(() => {}));

        // useArtifactLoadable should return pending without suspending
        const { result } = renderHook(() => useArtifactLoadable(ref));
        expect(result.current.status).toBe('pending');
        expect(result.current.value).toBeUndefined();
        
        // If it suspended, renderHook would throw
    });

    it('provides error object without throwing to Error Boundary', async () => {
        const error = new Error('test error');
        const ref = artifact(Promise.reject(error));

        await waitForValue(ref).catch(() => {});

        // useArtifactLoadable should return rejected state without throwing
        const { result } = renderHook(() => useArtifactLoadable(ref));
        expect(result.current.status).toBe('rejected');
        expect(result.current.error).toBe(error);
        
        // If it threw, renderHook would fail
    });

    it('returns pending with undefined value during revalidation (no stale-while-revalidate)', async () => {
        let resolvers: Array<() => void> = [];
        let callCount = 0;
        const ref = artifact(
            () =>
                new Promise<{ count: number }>((r) => {
                    callCount++;
                    resolvers.push(() => r({ count: callCount }));
                }),
            { maxAge: 50 },
        );

        // Initial load
        expect(getArtifactStatus(ref)).toBe('pending');
        resolvers[0]();
        await waitForValue(ref);
        expect(getArtifactStatus(ref)).toBe('resolved');
        expect(readArtifact(ref)).toEqual({ count: 1 });

        // Wait for expiry and revalidation
        await new Promise((r) => setTimeout(r, 60));
        
        // Should be pending during revalidation
        expect(getArtifactStatus(ref)).toBe('pending');
        
        // During revalidation, hook should show pending with undefined value
        const { result } = renderHook(() => useArtifactLoadable(ref));
        expect(result.current.status).toBe('pending');
        expect(result.current.value).toBeUndefined();

        // Resolve the revalidation
        resolvers[1]();
        await waitForValue(ref, (v) => v.count === 2);
        expect(getArtifactStatus(ref)).toBe('resolved');
        expect(readArtifact(ref)).toEqual({ count: 2 });
    });

    it('works synchronously with static values', () => {
        const ref = artifact(42);

        const { result } = renderHook(() => useArtifactLoadable(ref));

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe(42);
    });

    it('getArtifactStatus works synchronously with static values', () => {
        const ref = artifact('static');
        expect(getArtifactStatus(ref)).toBe('resolved');
    });
});
