import { atom, createStore } from 'jotai';
import { atomFamily } from 'jotai/utils';
import {
    artifact,
    readArtifact,
    subscribeArtifact,
    writeArtifact,
} from '../src/index';
import { ITERATIONS, printTable, type BenchRow } from './shared';

function runExtraMicroBenchmarks(): BenchRow[] {
    const results: BenchRow[] = [];

    // Sync write (10 subscribers) — fair: both notify 10 listeners per write
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);
        const subs: Array<() => void> = [];
        for (let i = 0; i < 10; i += 1) {
            subs.push(jotaiStore.sub(jotaiAtom, () => {}));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiAtom, i);
        }
        const jotaiMs = performance.now() - t0;

        for (const unsub of subs) {
            unsub();
        }

        const artRef = artifact(0);
        const artSubs: Array<() => void> = [];
        for (let i = 0; i < 10; i += 1) {
            artSubs.push(subscribeArtifact(artRef, () => {}));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            writeArtifact(artRef, i);
        }
        const artifactMs = performance.now() - t1;

        for (const unsub of artSubs) {
            unsub();
        }

        results.push({ operation: 'Sync write (10 subs)', jotaiMs, artifactMs });
    }

    // Sync write (100 subscribers) — fair: both notify 100 listeners per write
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);
        const subs: Array<() => void> = [];
        for (let i = 0; i < 100; i += 1) {
            subs.push(jotaiStore.sub(jotaiAtom, () => {}));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiAtom, i);
        }
        const jotaiMs = performance.now() - t0;

        for (const unsub of subs) {
            unsub();
        }

        const artRef = artifact(0);
        const artSubs: Array<() => void> = [];
        for (let i = 0; i < 100; i += 1) {
            artSubs.push(subscribeArtifact(artRef, () => {}));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            writeArtifact(artRef, i);
        }
        const artifactMs = performance.now() - t1;

        for (const unsub of artSubs) {
            unsub();
        }

        results.push({ operation: 'Sync write (100 subs)', jotaiMs, artifactMs });
    }

    // Sync write (1000 subscribers) — fair: both notify 1000 listeners per write
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);
        const subs: Array<() => void> = [];
        for (let i = 0; i < 1000; i += 1) {
            subs.push(jotaiStore.sub(jotaiAtom, () => {}));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiAtom, i);
        }
        const jotaiMs = performance.now() - t0;

        for (const unsub of subs) {
            unsub();
        }

        const artRef = artifact(0);
        const artSubs: Array<() => void> = [];
        for (let i = 0; i < 1000; i += 1) {
            artSubs.push(subscribeArtifact(artRef, () => {}));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            writeArtifact(artRef, i);
        }
        const artifactMs = performance.now() - t1;

        for (const unsub of artSubs) {
            unsub();
        }

        results.push({ operation: 'Sync write (1000 subs)', jotaiMs, artifactMs });
    }

    // Parameterized lookup (cold create) — Jotai atomFamily vs Artifact factory
    {
        // Jotai atomFamily: creates atoms on-demand with caching
        const jotaiFamily = atomFamily((id: number) => id);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiFamily(i); // cold create
        }
        const jotaiMs = performance.now() - t0;

        // Artifact factory: parameterized artifact with caching
        const artFactory = artifact(({ id }: { id: number }) => id);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFactory({ id: i }); // cold create
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family (cold create)', jotaiMs, artifactMs });
    }

    // Parameterized lookup (warm hit) — cached instances
    {
        const jotaiFamily = atomFamily((id: number) => id);
        // Pre-warm cache
        for (let i = 0; i < 1000; i += 1) {
            jotaiFamily(i);
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiFamily(i % 1000); // warm hit
        }
        const jotaiMs = performance.now() - t0;

        const artFactory = artifact(({ id }: { id: number }) => id);
        // Pre-warm cache
        for (let i = 0; i < 1000; i += 1) {
            artFactory({ id: i });
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFactory({ id: i % 1000 }); // warm hit
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family (warm hit)', jotaiMs, artifactMs });
    }

    // Derived fan-out: one base, 50 derived — measures update propagation
    // When base updates, all 50 derived need to recompute
    {
        const jotaiStore = createStore();
        const jotaiBase = atom(1);
        const jotaiDerived: ReturnType<typeof atom>[] = [];
        for (let i = 0; i < 50; i += 1) {
            jotaiDerived.push(atom((get) => get(jotaiBase) * (i + 1)));
        }

        // Subscribe to all derived to ensure they track dependencies
        const subs: Array<() => void> = [];
        for (const derived of jotaiDerived) {
            subs.push(jotaiStore.sub(derived, () => {}));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiBase, i);
        }
        const jotaiMs = performance.now() - t0;

        for (const unsub of subs) {
            unsub();
        }

        const artBase = artifact(1);
        const artDerived: ReturnType<typeof artifact>[] = [];
        for (let i = 0; i < 50; i += 1) {
            artDerived.push(artifact(({ get }) => get(artBase) * (i + 1)));
        }

        // Subscribe to all derived to ensure they track dependencies
        const artSubs: Array<() => void> = [];
        for (const derived of artDerived) {
            artSubs.push(subscribeArtifact(derived, () => {}));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            writeArtifact(artBase, i);
        }
        const artifactMs = performance.now() - t1;

        for (const unsub of artSubs) {
            unsub();
        }

        results.push({ operation: 'Derived fan-out (50)', jotaiMs, artifactMs });
    }

    // Derived fan-out (read after write) — measures recomputation cost
    // After writing base, read all 50 derived values (forces recompute)
    {
        const jotaiStore = createStore();
        const jotaiBase = atom(1);
        const jotaiDerived: ReturnType<typeof atom>[] = [];
        for (let i = 0; i < 50; i += 1) {
            jotaiDerived.push(atom((get) => get(jotaiBase) * (i + 1)));
        }

        const REDUCED_ITERATIONS = Math.floor(ITERATIONS / 10); // Reduce to avoid excessive runtime

        const t0 = performance.now();
        for (let i = 0; i < REDUCED_ITERATIONS; i += 1) {
            jotaiStore.set(jotaiBase, i);
            for (const derived of jotaiDerived) {
                jotaiStore.get(derived);
            }
        }
        const jotaiMs = performance.now() - t0;

        const artBase = artifact(1);
        const artDerived: ReturnType<typeof artifact>[] = [];
        for (let i = 0; i < 50; i += 1) {
            artDerived.push(artifact(({ get }) => get(artBase) * (i + 1)));
        }

        const t1 = performance.now();
        for (let i = 0; i < REDUCED_ITERATIONS; i += 1) {
            writeArtifact(artBase, i);
            for (const derived of artDerived) {
                readArtifact(derived);
            }
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Read 50 derived/write', jotaiMs, artifactMs });
    }

    // Async settlement micro — promise resolve + one subscriber
    // Fair: both libraries resolve a promise and notify one listener
    {
        const jotaiStore = createStore();

        const t0 = performance.now();
        const promises: Promise<void>[] = [];
        for (let i = 0; i < 1000; i += 1) {
            const jotaiAtom = atom(Promise.resolve(i));
            const unsub = jotaiStore.sub(jotaiAtom, () => {});
            promises.push(
                jotaiStore.get(jotaiAtom).then(() => {
                    unsub();
                }),
            );
        }
        Promise.all(promises).then(() => {
            const jotaiMs = performance.now() - t0;

            const t1 = performance.now();
            const artPromises: Promise<void>[] = [];
            for (let i = 0; i < 1000; i += 1) {
                const artRef = artifact(Promise.resolve(i));
                const unsub = subscribeArtifact(artRef, () => {});
                artPromises.push(
                    new Promise<void>((resolve) => {
                        const checkResolved = () => {
                            const value = readArtifact(artRef);
                            if (value !== undefined) {
                                unsub();
                                resolve();
                            } else {
                                setTimeout(checkResolved, 0);
                            }
                        };
                        checkResolved();
                    }),
                );
            }
            Promise.all(artPromises).then(() => {
                const artifactMs = performance.now() - t1;

                results.push({ operation: 'Async settle (1000)', jotaiMs, artifactMs });

                // Print results after async benchmark completes
                printTable(
                    `Extra micro benchmarks (${ITERATIONS.toLocaleString()} iterations)`,
                    results,
                );
            });
        });

        // Return early results for sync benchmarks
        return results.slice(0, -1); // Exclude async benchmark until it completes
    }

    // This code is unreachable due to async benchmark, but TypeScript needs a return
    return results;
}

// Run benchmarks
const syncResults = runExtraMicroBenchmarks();
// Only print sync results if no async benchmark is present
if (syncResults.length === 7) {
    printTable(`Extra micro benchmarks (${ITERATIONS.toLocaleString()} iterations)`, syncResults);
}
