import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    artifact,
    useArtifact,
    useArtifactValue,
    useResetArtifact,
    useSetArtifact,
    writeArtifact,
} from '../src/index';

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

describe('React hooks', () => {
    it('useArtifactValue re-renders when the same ref is written elsewhere', () => {
        const count = artifact(0);
        const { result } = renderHook(() => useArtifactValue(count));

        expect(result.current).toBe(0);

        act(() => {
            writeArtifact(count, 7);
        });

        expect(result.current).toBe(7);
    });


    it('useArtifactValue does not re-render when writing the same value', () => {
        const count = artifact(0);
        let renders = 0;

        function Reader() {
            renders += 1;
            const value = useArtifactValue(count);
            return <span data-testid="same-value">{value}</span>;
        }

        render(<Reader />);
        expect(renders).toBe(1);

        act(() => {
            writeArtifact(count, 0);
        });

        expect(screen.getByTestId('same-value').textContent).toBe('0');
        expect(renders).toBe(1);
    });

    it('useSetArtifact writes without subscribing the setter component', () => {
        const count = artifact(0);
        let setterRenders = 0;

        function Setter() {
            setterRenders += 1;
            const setCount = useSetArtifact(count);
            return (
                <button type="button" onClick={() => setCount(1)}>
                    set
                </button>
            );
        }

        function Reader() {
            const value = useArtifactValue(count);
            return <span data-testid="setter-value">{value}</span>;
        }

        render(
            <>
                <Setter />
                <Reader />
            </>,
        );

        expect(setterRenders).toBe(1);
        expect(screen.getByTestId('setter-value').textContent).toBe('0');

        act(() => {
            screen.getByRole('button', { name: 'set' }).click();
        });

        expect(screen.getByTestId('setter-value').textContent).toBe('1');
        expect(setterRenders).toBe(1);
    });

    it('useResetArtifact restores the initial value', () => {
        const count = artifact(0);
        const { result } = renderHook(() => useArtifact(count));

        act(() => {
            result.current[1](42);
        });
        expect(result.current[0]).toBe(42);

        act(() => {
            result.current[2]();
        });
        expect(result.current[0]).toBe(0);
    });

    it('useResetArtifact re-fetches async data', async () => {
        let n = 0;
        const ref = artifact(async () => ++n);

        function Reader() {
            const value = useArtifactValue(ref);
            const reset = useResetArtifact(ref);
            return (
                <div>
                    <span data-testid="async-value">{value}</span>
                    <button type="button" onClick={reset}>
                        refresh
                    </button>
                </div>
            );
        }

        await act(async () => {
            render(
                <Suspense fallback={<div>Loading async reset...</div>}>
                    <Reader />
                </Suspense>,
            );
        });

        expect(screen.getByTestId('async-value').textContent).toBe('1');

        await act(async () => {
            screen.getByRole('button', { name: 'refresh' }).click();
        });

        await waitFor(() => expect(screen.getByTestId('async-value').textContent).toBe('2'));
    });

    it('suspends on async artifacts then shows the resolved value', async () => {
        let resolve!: (value: { id: number; name: string }[]) => void;
        const users = artifact(
            () =>
                new Promise<{ id: number; name: string }[]>((r) => {
                    resolve = r;
                }),
        );

        function UserList() {
            const list = useArtifactValue(users);
            return <div data-testid="user-name">{list[0].name}</div>;
        }

        await act(async () => {
            render(
                <Suspense fallback={<div>Loading users...</div>}>
                    <UserList />
                </Suspense>,
            );
        });

        expect(screen.getByText('Loading users...')).toBeTruthy();

        await act(async () => {
            resolve([{ id: 1, name: 'Ada' }]);
        });

        expect(screen.getByTestId('user-name').textContent).toBe('Ada');
    });

    it('propagates rejected artifacts to an error boundary', async () => {
        const onError = vi.fn();
        const failing = artifact(async () => {
            throw new Error('boom');
        });

        function Broken() {
            useArtifactValue(failing);
            return null;
        }

        await act(async () => {
            render(
                <TestErrorBoundary onError={onError}>
                    <Suspense fallback={<div>Loading error case...</div>}>
                        <Broken />
                    </Suspense>
                </TestErrorBoundary>,
            );
        });

        expect(screen.getByText('Error: boom')).toBeTruthy();
        expect(onError).toHaveBeenCalled();
    });
});
