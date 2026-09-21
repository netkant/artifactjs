import { artifact, readArtifact } from '../src/index';

const ITERS = 100000;

console.log('\nIsolated cold path benchmark (100k iterations)');
console.log('==============================================\n');

// Test 1: Just ref creation
{
    const artFamily = artifact(({ id }: { id: number }) => id);
    
    const start = performance.now();
    for (let i = 0; i < ITERS; i += 1) {
        artFamily({ id: i });
    }
    const elapsed = performance.now() - start;
    console.log(`Ref creation only:           ${elapsed.toFixed(2)}ms`);
}

// Test 2: Ref + readArtifact (full cold)
{
    const artFamily = artifact(({ id }: { id: number }) => id);
    
    const start = performance.now();
    for (let i = 0; i < ITERS; i += 1) {
        const ref = artFamily({ id: i });
        readArtifact(ref);
    }
    const elapsed = performance.now() - start;
    console.log(`Ref + readArtifact (cold):   ${elapsed.toFixed(2)}ms`);
}

// Test 3: Same as benchmark structure
{
    const artFamily = artifact(({ id }: { id: number }) => id);
    
    const start = performance.now();
    for (let i = 0; i < ITERS; i += 1) {
        const ref = artFamily({ id: i });
        readArtifact(ref);
    }
    const elapsed = performance.now() - start;
    console.log(`Benchmark structure:         ${elapsed.toFixed(2)}ms`);
}

// Test 4: Object allocation overhead
{
    const start = performance.now();
    for (let i = 0; i < ITERS; i += 1) {
        const obj = { id: i };
    }
    const elapsed = performance.now() - start;
    console.log(`Object allocation only:      ${elapsed.toFixed(2)}ms`);
}

// Test 5: Key generation isolated
{
    const artFamily = artifact(({ id }: { id: number }) => id);
    const refs = Array.from({ length: 100 }, (_, i) => artFamily({ id: i }));
    
    const start = performance.now();
    for (let i = 0; i < ITERS; i += 1) {
        artFamily({ id: i % 100 });
    }
    const elapsed = performance.now() - start;
    console.log(`Key gen (100 unique):        ${elapsed.toFixed(2)}ms`);
}

console.log('');
