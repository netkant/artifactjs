// Standalone benchmark to measure key generation overhead directly
import { ITERATIONS } from './shared';

// Simulate stableStringify (old approach)
function stableStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        const pairs = keys.map(key => JSON.stringify(key) + ':' + stableStringify((value as Record<string, unknown>)[key]));
        return '{' + pairs.join(',') + '}';
    }
    
    return String(value);
}

// Simulate tiered key generation (new approach)
function isPrimitive(value: unknown): boolean {
    const t = typeof value;
    return (
        value === null ||
        value === undefined ||
        t === 'string' ||
        t === 'number' ||
        t === 'boolean' ||
        t === 'bigint'
    );
}

function isFlatObject(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    
    for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            continue;
        }
        const val = (value as Record<string, unknown>)[key];
        if (!isPrimitive(val)) {
            return false;
        }
    }
    
    return true;
}

function fastPrimitiveKey(value: unknown): string {
    if (value === null) return 'p:n:null';
    if (value === undefined) return 'p:u:undefined';
    
    const t = typeof value;
    if (t === 'string') return `p:s:${value}`;
    if (t === 'number') return `p:n:${value}`;
    if (t === 'boolean') return `p:b:${value}`;
    if (t === 'bigint') return `p:i:${value}`;
    
    return `p:?:${String(value)}`;
}

function fastFlatObjectKey(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];
    
    for (const key of keys) {
        const val = obj[key];
        let valStr: string;
        
        if (val === null) {
            valStr = 'null';
        } else if (val === undefined) {
            valStr = 'undefined';
        } else {
            valStr = String(val);
        }
        
        pairs.push(`${key}:${valStr}`);
    }
    
    return `f:${pairs.join(',')}`;
}

function tieredKey(args: unknown[]): string {
    const firstArg = args[0];
    
    if (args.length === 1 && isPrimitive(firstArg)) {
        return fastPrimitiveKey(firstArg);
    }
    
    if (args.length === 1 && isFlatObject(firstArg)) {
        return fastFlatObjectKey(firstArg as Record<string, unknown>);
    }
    
    return stableStringify(args);
}

console.log('\nKey generation microbenchmark (100,000 iterations)');
console.log('==================================================\n');

// Benchmark 1: Primitive argument (number)
{
    const args = [42];
    
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        stableStringify(args);
    }
    const oldMs = performance.now() - t0;
    
    const t1 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        tieredKey(args);
    }
    const newMs = performance.now() - t1;
    
    const speedup = ((oldMs - newMs) / oldMs * 100).toFixed(1);
    console.log(`Primitive (number):`);
    console.log(`  Old (stableStringify): ${oldMs.toFixed(2)}ms`);
    console.log(`  New (tiered):          ${newMs.toFixed(2)}ms`);
    console.log(`  Speedup:               ${speedup}%\n`);
}

// Benchmark 2: Flat object with primitives
{
    const args = [{ id: 123, name: 'test', active: true }];
    
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        stableStringify(args);
    }
    const oldMs = performance.now() - t0;
    
    const t1 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        tieredKey(args);
    }
    const newMs = performance.now() - t1;
    
    const speedup = ((oldMs - newMs) / oldMs * 100).toFixed(1);
    console.log(`Flat object (primitives only):`);
    console.log(`  Old (stableStringify): ${oldMs.toFixed(2)}ms`);
    console.log(`  New (tiered):          ${newMs.toFixed(2)}ms`);
    console.log(`  Speedup:               ${speedup}%\n`);
}

// Benchmark 3: Nested object (should fallback to stableStringify)
{
    const args = [{ user: { id: 123, name: 'test' } }];
    
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        stableStringify(args);
    }
    const oldMs = performance.now() - t0;
    
    const t1 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        tieredKey(args);
    }
    const newMs = performance.now() - t1;
    
    const overhead = ((newMs - oldMs) / oldMs * 100).toFixed(1);
    console.log(`Nested object (fallback):`);
    console.log(`  Old (stableStringify): ${oldMs.toFixed(2)}ms`);
    console.log(`  New (tiered):          ${newMs.toFixed(2)}ms`);
    console.log(`  Overhead:              ${overhead}%\n`);
}

// Benchmark 4: Varied params (common use case)
{
    const params = [
        [{ id: 1 }],
        [{ id: 2, type: 'user' }],
        [{ page: 1, limit: 10 }],
        [{ id: 123, active: true, name: 'test' }],
        [42],
    ];
    
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        stableStringify(params[i % params.length]);
    }
    const oldMs = performance.now() - t0;
    
    const t1 = performance.now();
    for (let i = 0; i < ITERATIONS; i += 1) {
        tieredKey(params[i % params.length]);
    }
    const newMs = performance.now() - t1;
    
    const speedup = ((oldMs - newMs) / oldMs * 100).toFixed(1);
    console.log(`Mixed params (realistic):`);
    console.log(`  Old (stableStringify): ${oldMs.toFixed(2)}ms`);
    console.log(`  New (tiered):          ${newMs.toFixed(2)}ms`);
    console.log(`  Speedup:               ${speedup}%\n`);
}
