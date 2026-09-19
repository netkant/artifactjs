import { atom, createStore } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { artifact, readArtifact } from '../src/index';
import { ITERATIONS, printTable, type BenchRow } from './shared';

function runParameterizedBenchmarks(): BenchRow[] {
    const results: BenchRow[] = [];

    // Family cold: create new instances with different params
    {
        const jotaiStore = createStore();
        const jotaiFamily = atomFamily((id: number) => atom(id));

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = jotaiFamily(i);
            jotaiStore.get(ref);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id }: { id: number }) => id);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = artFamily({ id: i });
            readArtifact(ref);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family cold (new ids)', jotaiMs, artifactMs });
    }

    // Family warm: repeatedly call family({ id }) for existing instances
    // This measures createCacheKey + Map.get on cached instances
    {
        const jotaiStore = createStore();
        const jotaiFamily = atomFamily((id: number) => atom(id));

        // Pre-warm 100 instances
        for (let i = 0; i < 100; i += 1) {
            jotaiStore.get(jotaiFamily(i));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = jotaiFamily(i % 100);
            jotaiStore.get(ref);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id }: { id: number }) => id);

        // Pre-warm 100 instances
        for (let i = 0; i < 100; i += 1) {
            readArtifact(artFamily({ id: i }));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = artFamily({ id: i % 100 });
            readArtifact(ref);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family warm (100 ids)', jotaiMs, artifactMs });
    }

    // Family with flat object params (fast path)
    {
        const jotaiStore = createStore();
        const jotaiFamily = atomFamily((params: { id: number; name: string }) => atom(params));

        // Pre-warm
        for (let i = 0; i < 1000; i += 1) {
            jotaiStore.get(jotaiFamily({ id: i, name: 'test' }));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = jotaiFamily({ id: i % 1000, name: 'test' });
            jotaiStore.get(ref);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id, name }: { id: number; name: string }) => ({ id, name }));

        // Pre-warm
        for (let i = 0; i < 1000; i += 1) {
            readArtifact(artFamily({ id: i, name: 'test' }));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = artFamily({ id: i % 1000, name: 'test' });
            readArtifact(ref);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family warm (flat obj)', jotaiMs, artifactMs });
    }

    // Family with nested object params (slow path)
    {
        const jotaiStore = createStore();
        const jotaiFamily = atomFamily((params: { user: { id: number } }) => atom(params));

        // Pre-warm
        for (let i = 0; i < 1000; i += 1) {
            jotaiStore.get(jotaiFamily({ user: { id: i } }));
        }

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = jotaiFamily({ user: { id: i % 1000 } });
            jotaiStore.get(ref);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ user }: { user: { id: number } }) => user);

        // Pre-warm
        for (let i = 0; i < 1000; i += 1) {
            readArtifact(artFamily({ user: { id: i } }));
        }

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const ref = artFamily({ user: { id: i % 1000 } });
            readArtifact(ref);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family warm (nested)', jotaiMs, artifactMs });
    }

    return results;
}

printTable(`Parameterized family benchmarks (${ITERATIONS.toLocaleString()} iterations)`, runParameterizedBenchmarks());
