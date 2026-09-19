import { renderToString } from 'react-dom/server';
import { Component, Suspense, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
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

describe('SSR behavior', () => {
    describe('static artifacts', () => {
        it('SSR HTML contains artifact value', () => {
            const userArtifact = artifact({ name: 'Alice', id: 42 });

            function UserProfile() {
                const user = useArtifactValue(userArtifact);
                return <div data-testid="user">{user.name}</div>;
            }

            // Server render produces HTML with the artifact value
            const serverHTML = renderToString(<UserProfile />);
            expect(serverHTML).toContain('Alice');

            // Same-process read sees the same value
            const sameProcessValue = readArtifact(userArtifact);
            expect(sameProcessValue).toEqual({ name: 'Alice', id: 42 });
        });

        it('static primitives render in SSR output', () => {
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

            // Same-process reads match SSR output
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

    describe('SSR output consistency', () => {
        it('static artifact value appears in SSR HTML', () => {
            const staticArtifact = artifact('consistent-value');

            function TestComponent() {
                const value = useArtifactValue(staticArtifact);
                return <div>{value}</div>;
            }

            const serverHTML = renderToString(<TestComponent />);
            expect(serverHTML).toContain('consistent-value');

            // Same-process read gets the same value
            const sameProcessValue = readArtifact(staticArtifact);
            expect(sameProcessValue).toBe('consistent-value');
        });

        it('derived artifacts compute correctly in SSR', () => {
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

            // Same-process read computes the same derived value
            const sameProcessValue = readArtifact(derived);
            expect(sameProcessValue).toBe(10);
        });

        it('modified artifact value reflects in SSR output', () => {
            const mutableArtifact = artifact(0);
            
            // Modify before SSR
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
        it('module-level artifacts retain state across renderToString calls', () => {
            // README documents: "module-level mutable store SSR caveats"
            // Artifacts are mutable and shared in the module scope
            // State persists across multiple renderToString calls in the same process
            
            const sharedCounter = artifact(0);
            
            // First render
            writeArtifact(sharedCounter, 1);
            
            function CounterComponent() {
                const count = useArtifactValue(sharedCounter);
                return <div>Count: {count}</div>;
            }
            
            const html1 = renderToString(<CounterComponent />);
            // React 19 adds comments around numbers: <!-- -->1
            expect(html1).toMatch(/<div>Count:\s*(?:<!--[^>]*-->)?1/);
            
            // Second render (same process, same artifact instance)
            // Counter still has value from previous render
            const html2 = renderToString(<CounterComponent />);
            expect(html2).toMatch(/<div>Count:\s*(?:<!--[^>]*-->)?1/); // State persisted!
            
            // This demonstrates the shared-store caveat: artifacts are not
            // automatically reset between renders
        });

        it('new artifact() calls are independent', () => {
            // Each artifact() call creates a new family/store
            const artifact1 = artifact(0);
            const artifact2 = artifact(0);
            
            writeArtifact(artifact1, 1);
            expect(readArtifact(artifact1)).toBe(1);
            
            // Different artifact() call = different store
            expect(readArtifact(artifact2)).toBe(0);
        });
    });
});
