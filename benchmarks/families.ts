import { atom, createStore } from 'jotai';
import { artifact, readArtifact } from '../src/index';
import { ITERATIONS, printTable, type BenchRow } from './shared';

function runParameterizedBenchmarks(): BenchRow[] {
    const results: BenchRow[] = [];

    // Family cold: create new instances with different params
    {
        const jotaiAtomFamily = (id: number) => atom(id);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiAtomFamily(i);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id }: { id: number }) => id);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFamily({ id: i });
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family cold (new ids)', jotaiMs, artifactMs });
    }

    // Family warm: re-access same instances
    {
        const jotaiStore = createStore();
        const jotaiAtomFamily = (id: number) => atom(id);
        const jotaiRefs = Array.from({ length: 100 }, (_, i) => jotaiAtomFamily(i));

        // Pre-warm
        jotaiRefs.forEach((ref) => jotaiStore.get(ref));

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiStore.get(jotaiRefs[i % 100]);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id }: { id: number }) => id);
        const artRefs = Array.from({ length: 100 }, (_, i) => artFamily({ id: i }));

        // Pre-warm
        artRefs.forEach((ref) => readArtifact(ref));

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            readArtifact(artRefs[i % 100]);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family warm (100 ids)', jotaiMs, artifactMs });
    }

    // Family key generation: flat object (fast path)
    {
        const jotaiAtomFamily = (params: { id: number; name: string }) => atom(params);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiAtomFamily({ id: i % 1000, name: 'test' });
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ id, name }: { id: number; name: string }) => ({ id, name }));

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFamily({ id: i % 1000, name: 'test' });
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family key (flat obj)', jotaiMs, artifactMs });
    }

    // Family key generation: nested object (slow path)
    {
        const jotaiAtomFamily = (params: { user: { id: number } }) => atom(params);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiAtomFamily({ user: { id: i % 1000 } });
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact(({ user }: { user: { id: number } }) => user);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFamily({ user: { id: i % 1000 } });
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family key (nested)', jotaiMs, artifactMs });
    }

    // Family key generation: primitive (fastest path)
    {
        const jotaiAtomFamily = (id: number) => atom(id);

        const t0 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            jotaiAtomFamily(i % 1000);
        }
        const jotaiMs = performance.now() - t0;

        const artFamily = artifact((params: any) => params);

        const t1 = performance.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            artFamily(i % 1000);
        }
        const artifactMs = performance.now() - t1;

        results.push({ operation: 'Family key (primitive)', jotaiMs, artifactMs });
    }

    return results;
}

printTable(`Parameterized family benchmarks (${ITERATIONS.toLocaleString()} iterations)`, runParameterizedBenchmarks());
