import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
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
        readArtifact(ref);
        await new Promise((r) => setTimeout(r, 10));
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

        const { result } = renderHook(() => useArtifactLoadable(ref));

        expect(result.current.status).toBe('pending');

        await act(async () => {
            resolve('done');
            await waitForValue(ref);
        });

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe('done');
    });

    it('returns rejected loadable when promise rejects', async () => {
        const error = new Error('failed');
        const ref = artifact(Promise.reject(error));

        const { result } = renderHook(() => useArtifactLoadable(ref));

        await act(async () => {
            await new Promise((r) => setTimeout(r, 10));
        });

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

        function UserList() {
            const loadable = useArtifactLoadable(users);
            const reset = useResetArtifact(users);

            if (loadable.status === 'pending') {
                return <div>Loading...</div>;
            }

            if (loadable.status === 'rejected') {
                return (
                    <div>
                        <p data-testid="error-message">Error: {(loadable.error as Error).message}</p>
                        <button type="button" onClick={reset}>
                            Retry
                        </button>
                    </div>
                );
            }

            // loadable.status is 'resolved' here
            const userList = loadable.value as unknown as { id: number; name: string }[];
            return <div>Users: {userList.length}</div>;
        }

        await act(async () => {
            render(<UserList />);
        });

        expect(screen.getByText('Loading...')).toBeTruthy();

        await act(async () => {
            reject(error);
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(screen.getByTestId('error-message').textContent).toBe('Error: fetch failed');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    it('re-renders when status changes after reset', async () => {
        let resolvers: Array<() => void> = [];
        let callCount = 0;
        const ref = artifact(
            () =>
                new Promise<number>((r) => {
                    callCount++;
                    resolvers.push(() => r(callCount));
                }),
        );

        const { result } = renderHook(() => useArtifactLoadable(ref));

        expect(result.current.status).toBe('pending');

        await act(async () => {
            resolvers[0]();
            await waitForValue(ref);
        });

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe(1);

        await act(async () => {
            resetArtifact(ref);
        });

        expect(result.current.status).toBe('pending');

        await act(async () => {
            resolvers[1]();
            await waitForValue(ref);
        });

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toBe(2);
    });

    it('works with parameterized artifacts', async () => {
        const user = artifact(async ({ id }: { id: number }) => ({ id, name: `User ${id}` }));

        const { result, rerender } = renderHook(({ userId }) => useArtifactLoadable(user({ id: userId })), {
            initialProps: { userId: 1 },
        });

        expect(result.current.status).toBe('pending');

        await act(async () => {
            await waitForValue(user({ id: 1 }));
        });

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toEqual({ id: 1, name: 'User 1' });

        rerender({ userId: 2 });
        expect(result.current.status).toBe('pending');

        await act(async () => {
            await waitForValue(user({ id: 2 }));
        });

        expect(result.current.status).toBe('resolved');
        expect(result.current.value).toEqual({ id: 2, name: 'User 2' });
    });

    it('handles retry flow with useResetArtifact', async () => {
        let shouldFail = true;
        let resolve!: (value: { id: number; name: string }[]) => void;
        let reject!: (error: Error) => void;
        
        const users = artifact(() => {
            return new Promise<{ id: number; name: string }[]>((res, rej) => {
                if (shouldFail) {
                    reject = rej;
                } else {
                    resolve = res;
                }
            });
        });

        function UserList() {
            const loadable = useArtifactLoadable(users);
            const reset = useResetArtifact(users);

            if (loadable.status === 'pending') {
                return <div data-testid="status">Loading...</div>;
            }

            if (loadable.status === 'rejected') {
                return (
                    <div>
                        <div data-testid="status">Error</div>
                        <button type="button" onClick={reset}>
                            Retry
                        </button>
                    </div>
                );
            }

            return <div data-testid="status">Success: {loadable.value.length} users</div>;
        }

        await act(async () => {
            render(<UserList />);
        });

        expect(screen.getByTestId('status').textContent).toBe('Loading...');

        await act(async () => {
            reject(new Error('network error'));
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(screen.getByTestId('status').textContent).toBe('Error');

        shouldFail = false;

        await act(async () => {
            screen.getByRole('button', { name: 'Retry' }).click();
        });

        expect(screen.getByTestId('status').textContent).toBe('Loading...');

        await act(async () => {
            resolve([{ id: 1, name: 'Alice' }]);
            await new Promise((r) => setTimeout(r, 10));
        });

        await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('Success: 1 users'));
    });

    it('does not suspend when used inside Suspense boundary', async () => {
        const onError = vi.fn();
        let resolve!: (value: string) => void;
        const ref = artifact(
            new Promise<string>((r) => {
                resolve = r;
            }),
        );

        function Content() {
            const loadable = useArtifactLoadable(ref);

            if (loadable.status === 'pending') {
                return <div data-testid="custom-loading">Custom loading...</div>;
            }

            return <div data-testid="content">{loadable.value}</div>;
        }

        await act(async () => {
            render(
                <TestErrorBoundary onError={onError}>
                    <Suspense fallback={<div data-testid="suspense-fallback">Suspense fallback</div>}>
                        <Content />
                    </Suspense>
                </TestErrorBoundary>,
            );
        });

        // Should show custom loading, not Suspense fallback
        expect(screen.getByTestId('custom-loading')).toBeTruthy();
        expect(screen.queryByTestId('suspense-fallback')).toBeNull();

        await act(async () => {
            resolve('ready');
            await waitForValue(ref);
        });

        expect(screen.getByTestId('content').textContent).toBe('ready');
        expect(onError).not.toHaveBeenCalled();
    });

    it('provides error object without throwing to Error Boundary', async () => {
        const error = new Error('test error');
        const ref = artifact(Promise.reject(error));
        const onError = vi.fn();

        function Content() {
            const loadable = useArtifactLoadable(ref);

            if (loadable.status === 'rejected') {
                return <div data-testid="inline-error">{(loadable.error as Error).message}</div>;
            }

            return null;
        }

        await act(async () => {
            render(
                <TestErrorBoundary onError={onError}>
                    <Content />
                </TestErrorBoundary>,
            );
        });

        await act(async () => {
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(screen.getByTestId('inline-error').textContent).toBe('test error');
        expect(onError).not.toHaveBeenCalled();
    });
});
