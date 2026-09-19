import { renderToString } from 'react-dom/server';
import { Component, Suspense, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    artifact,
    artifactWithStorage,
    readArtifact,
    useArtifactValue,
    writeArtifact,
} from '../src/index';

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

describe('SSR and hydration', () => {
    describe('static artifacts', () => {
        it('server render and client snapshot agree (no hydration mismatch)', () => {
            const userArtifact = artifact({ name: 'Alice', id: 42 });

            function UserProfile() {
                const user = useArtifactValue(userArtifact);
                return <div data-testid="user">{user.name}</div>;
            }

            // Server render
            const serverHTML = renderToString(<UserProfile />);
            expect(serverHTML).toContain('Alice');

            // Client should get the same value (same snapshot)
            const clientValue = readArtifact(userArtifact);
            expect(clientValue).toEqual({ name: 'Alice', id: 42 });
        });

        it('static primitives hydrate consistently', () => {
            const countArtifact = artifact(100);
            const nameArtifact = artifact('Bob');

            function Display() {
                const count = useArtifactValue(countArtifact);
                const name = useArtifactValue(nameArtifact);
                return (
                    <div>
                        <span data-testid="count">{count}</span>
                        <span data-testid="name">{name}</span>
                    </div>
                );
            }

            const serverHTML = renderToString(<Display />);
            expect(serverHTML).toContain('100');
            expect(serverHTML).toContain('Bob');

            // Verify client reads match server
            expect(readArtifact(countArtifact)).toBe(100);
            expect(readArtifact(nameArtifact)).toBe('Bob');
        });
    });

    describe('pending async artifacts', () => {
        it('suspends during SSR (shows Suspense fallback)', () => {
            const asyncArtifact = artifact<string>(async () => {
                // Never resolves during SSR pass
                return new Promise(() => {});
            });

            function AsyncComponent() {
                const value = useArtifactValue(asyncArtifact);
                return <div>Value: {String(value)}</div>;
            }

            // When rendering with Suspense on server, pending artifact causes Suspense to render fallback
            const serverHTML = renderToString(
                <Suspense fallback={<div>Loading...</div>}>
                    <AsyncComponent />
                </Suspense>,
            );

            // Server should render the fallback, not the component content
            expect(serverHTML).toContain('Loading...');
            expect(serverHTML).not.toContain('Value:');
        });

        it('handles multiple suspended artifacts in Suspense boundary', () => {
            const artifact1 = artifact<string>(async () => {
                return new Promise(() => {});
            });
            const artifact2 = artifact<string>(async () => {
                return new Promise(() => {});
            });

            function MultiAsyncComponent() {
                const val1 = useArtifactValue(artifact1);
                const val2 = useArtifactValue(artifact2);
                return (
                    <div>
                        {String(val1)} + {String(val2)}
                    </div>
                );
            }

            const serverHTML = renderToString(
                <Suspense fallback={<div>Loading multiple...</div>}>
                    <MultiAsyncComponent />
                </Suspense>,
            );

            expect(serverHTML).toContain('Loading multiple...');
        });
    });

    describe('rejected artifacts', () => {
        it('error propagates to Error Boundary during SSR', () => {
            const failingArtifact = artifact(() => {
                throw new Error('SSR failure');
            });

            function FailingComponent() {
                const value = useArtifactValue(failingArtifact);
                return <div>{value}</div>;
            }

            // Error should be caught by Error Boundary during SSR
            // renderToString will throw, so we need to catch it
            let serverHTML = '';
            let caughtError = false;
            
            try {
                serverHTML = renderToString(
                    <TestErrorBoundary>
                        <FailingComponent />
                    </TestErrorBoundary>,
                );
            } catch (error) {
                // In React SSR, errors during render can bubble up
                caughtError = true;
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('SSR failure');
            }
            
            // Either the error was caught by the boundary (serverHTML has error message)
            // or it bubbled up (caughtError is true)
            if (!caughtError) {
                expect(serverHTML).toContain('Error: SSR failure');
            } else {
                expect(caughtError).toBe(true);
            }
        });

        it('synchronous throw in derived artifact propagates', () => {
            const baseArtifact = artifact(10);
            const derivedArtifact = artifact(({ get }) => {
                const base = get(baseArtifact);
                if (base > 5) {
                    throw new Error('Value too large');
                }
                return base * 2;
            });

            function DerivedComponent() {
                const value = useArtifactValue(derivedArtifact);
                return <div>{value}</div>;
            }

            // Error during render should either be caught by boundary or throw
            let serverHTML = '';
            let caughtError = false;
            
            try {
                serverHTML = renderToString(
                    <TestErrorBoundary>
                        <DerivedComponent />
                    </TestErrorBoundary>,
                );
            } catch (error) {
                caughtError = true;
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('Value too large');
            }
            
            if (!caughtError) {
                expect(serverHTML).toContain('Error: Value too large');
            } else {
                expect(caughtError).toBe(true);
            }
        });
    });

    describe('artifactWithStorage in SSR environment', () => {
        // Note: jsdom provides localStorage, so we test the documented behavior
        // In real Node SSR (without jsdom), localStorage would not exist
        
        it('artifactWithStorage works in jsdom (browser-like environment)', () => {
            // In jsdom, localStorage exists, so storage artifacts work
            const storageArtifact = artifactWithStorage('ssr-test-key', 'default-value');

            function StorageComponent() {
                const value = useArtifactValue(storageArtifact);
                return <div>Value: {value}</div>;
            }

            const serverHTML = renderToString(<StorageComponent />);
            // React 19 may add comments around string values
            expect(serverHTML).toMatch(/Value:\s*(?:<!--[^>]*-->)?default-value/);
        });

        it('artifactWithStorage with custom storage backend', () => {
            // Safe pattern: provide custom storage implementation
            const mockStorage = {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
                clear: () => {},
                length: 0,
                key: () => null,
            } as Storage;

            const safeStorage = artifactWithStorage('safe-key', 'fallback', {
                storage: () => mockStorage,
            });

            function StorageComponent() {
                const value = useArtifactValue(safeStorage);
                return <div>Value: {value}</div>;
            }

            const serverHTML = renderToString(<StorageComponent />);
            expect(serverHTML).toMatch(/Value:\s*(?:<!--[^>]*-->)?fallback/);
        });

        it('documents storage artifact SSR caveat for real Node environments', () => {
            // This test documents the README guidance:
            // "storage artifacts are unsafe at module level on server"
            
            // In real Node.js SSR (not jsdom), localStorage doesn't exist
            // The problem: artifactWithStorage immediately tries to read from storage
            // Safe pattern: guard artifact creation or provide custom storage
            
            // Pattern 1: Guard storage access with a function
            const getStorageArtifact = () => {
                if (typeof localStorage === 'undefined') {
                    // Return regular artifact in SSR
                    return artifact('ssr-fallback');
                }
                return artifactWithStorage('client-key', 'client-default');
            };

            // Pattern 2: Use custom storage that works in both environments
            const universalStorageArtifact = artifactWithStorage('universal-key', 'default', {
                storage: () => {
                    // Provide a storage implementation that works everywhere
                    return typeof localStorage !== 'undefined'
                        ? localStorage
                        : ({
                            getItem: () => null,
                            setItem: () => {},
                            removeItem: () => {},
                            clear: () => {},
                            length: 0,
                            key: () => null,
                        } as Storage);
                },
            });

            function Component() {
                const value = useArtifactValue(universalStorageArtifact);
                return <div>Value: {value}</div>;
            }

            const serverHTML = renderToString(<Component />);
            expect(serverHTML).toMatch(/Value:\s*(?:<!--[^>]*-->)?default/);
        });
    });

    describe('server/client snapshot consistency', () => {
        it('useSyncExternalStore gets same snapshot on server and client', () => {
            // This is the core mechanism that prevents hydration mismatches
            // The library uses useSyncExternalStore with getSnapshot and getServerSnapshot
            // For artifacts, both should return the same value
            
            const staticArtifact = artifact('consistent-value');

            function TestComponent() {
                const value = useArtifactValue(staticArtifact);
                return <div>{value}</div>;
            }

            // Server render
            const serverHTML = renderToString(<TestComponent />);
            expect(serverHTML).toContain('consistent-value');

            // Client should see the same value (no mismatch warning)
            const clientValue = readArtifact(staticArtifact);
            expect(clientValue).toBe('consistent-value');
        });

        it('derived artifacts are consistent across server and client', () => {
            const base = artifact(5);
            const derived = artifact(({ get }) => {
                const val = get(base);
                return val * 2;
            });

            function DerivedComponent() {
                const value = useArtifactValue(derived);
                return <div>Result: {value}</div>;
            }

            const serverHTML = renderToString(<DerivedComponent />);
            // React 19 adds comments around numbers in SSR: <!-- -->10
            expect(serverHTML).toMatch(/<div>Result:\s*(?:<!--[^>]*-->)?10/);

            // Client should compute the same derived value
            const clientValue = readArtifact(derived);
            expect(clientValue).toBe(10);
        });

        it('modified artifact on server reflects in SSR output', () => {
            const mutableArtifact = artifact(0);
            
            // Modify before SSR (simulating server-side initialization)
            writeArtifact(mutableArtifact, 999);

            function Component() {
                const value = useArtifactValue(mutableArtifact);
                return <div>Value: {value}</div>;
            }

            const serverHTML = renderToString(<Component />);
            // React 19 adds comments around numbers in SSR: <!-- -->999
            expect(serverHTML).toMatch(/<div>Value:\s*(?:<!--[^>]*-->)?999/);
        });
    });

    describe('mutable store SSR caveats', () => {
        it('documents that modified artifacts retain state across SSR renders', () => {
            // README documents: "module-level mutable store SSR caveats"
            // Artifacts are mutable and shared globally
            // In SSR, this means state persists across requests if not reset
            
            const sharedCounter = artifact(0);
            
            // Simulate first request
            writeArtifact(sharedCounter, 1);
            
            function CounterComponent() {
                const count = useArtifactValue(sharedCounter);
                return <div>Count: {count}</div>;
            }
            
            const html1 = renderToString(<CounterComponent />);
            // React 19 adds comments around numbers: <!-- -->1
            expect(html1).toMatch(/<div>Count:\s*(?:<!--[^>]*-->)?1/);
            
            // Simulate second request (same process)
            // Counter still has value from previous request
            const html2 = renderToString(<CounterComponent />);
            expect(html2).toMatch(/<div>Count:\s*(?:<!--[^>]*-->)?1/); // State persisted!
            
            // This demonstrates why artifacts should be request-scoped in SSR
            // or reset between requests in real server implementations
        });

        it('fresh artifact instances are isolated per request pattern', () => {
            // Safe SSR pattern: create fresh artifacts per request
            const createRequestArtifact = () => artifact(0);
            
            // Request 1
            const artifact1 = createRequestArtifact();
            writeArtifact(artifact1, 1);
            expect(readArtifact(artifact1)).toBe(1);
            
            // Request 2
            const artifact2 = createRequestArtifact();
            expect(readArtifact(artifact2)).toBe(0); // Fresh state
        });
    });
});
