import { atom, createStore } from 'jotai';
import {
    artifact,
    readArtifact,
    resetArtifact,
    subscribeArtifact,
    writeArtifact,
} from '../src/index';
import { ITERATIONS, printTable, type BenchRow } from './shared';

function runMicroBenchmarks(): BenchRow[] {
    const results: BenchRow[] = [];

    // Create — matches app benchmark.jsx (Jotai first, then Artifact)
    {
        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            atom(i);
        }
        const jotaiMs = performance.now() - t0;

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artifact(i);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Create', jotaiMs, artifactMs });
    }

    // Sync read
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(42);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.get(jotaiAtom);
        }
        const jotaiMs = performance.now() - t0;

        const artRef = artifact(42);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            readArtifact(artRef);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Sync read', jotaiMs, artifactMs });
    }

    // Sync write (1 subscriber)
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);
        jotaiStore.sub(jotaiAtom, () => {});

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiAtom, i);
        }
        const jotaiMs = performance.now() - t0;

        const artRef = artifact(0);
        subscribeArtifact(artRef, () => {});

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            writeArtifact(artRef, i);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Sync write (1 sub)', jotaiMs, artifactMs });
    }

    // Subscribe / unsubscribe
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const unsub = jotaiStore.sub(jotaiAtom, () => {});
            unsub();
        }
        const jotaiMs = performance.now() - t0;

        const artRef = artifact(0);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const unsub = subscribeArtifact(artRef, () => {});
            unsub();
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Subscribe/unsub', jotaiMs, artifactMs });
    }

    // Derived read
    {
        const jotaiStore = createStore();
        const baseAtom = atom(1);
        const derivedAtom = atom((get) => get(baseAtom) * 2);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.get(derivedAtom);
        }
        const jotaiMs = performance.now() - t0;

        const baseArt = artifact(1);
        const derivedArt = artifact(({ get }) => get(baseArt) * 2);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            readArtifact(derivedArt);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Derived read', jotaiMs, artifactMs });
    }

    // Reset (static): Jotai writes 0; Artifact resetArtifact
    {
        const jotaiStore = createStore();
        const jotaiAtom = atom(0);
        jotaiStore.sub(jotaiAtom, () => {});
        jotaiStore.set(jotaiAtom, 999);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiAtom, 0);
        }
        const jotaiMs = performance.now() - t0;

        const artRef = artifact(0);
        subscribeArtifact(artRef, () => {});
        writeArtifact(artRef, 999);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            resetArtifact(artRef);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Reset (static)', jotaiMs, artifactMs });
    }

    // Reset (derived): both restore the source so the derived recomputes
    // (Jotai writable derived write ≈ Artifact resetArtifact(base)).
    {
        const jotaiStore = createStore();
        const jotaiBase = atom(1);
        const jotaiDerived = atom(
            (get) => get(jotaiBase) * 2,
            (_get, set) => {
                set(jotaiBase, 1);
            },
        );
        jotaiStore.sub(jotaiDerived, () => {});
        jotaiStore.set(jotaiBase, 50);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.set(jotaiDerived);
        }
        const jotaiMs = performance.now() - t0;

        const artBase = artifact(1);
        const artDerived = artifact(({ get }) => get(artBase) * 2);
        subscribeArtifact(artDerived, () => {});
        writeArtifact(artBase, 50);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            resetArtifact(artBase);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Reset (derived)', jotaiMs, artifactMs });
    }

    return results;
}

printTable(`Micro benchmarks (${ITERATIONS.toLocaleString()} iterations)`, runMicroBenchmarks());
