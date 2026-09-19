import { describe, expect, it } from 'vitest';
import {
    artifact,
    readArtifact,
    writeArtifact,
    type Artifact,
} from '../src/index';

describe('circular dependency detection', () => {
    it('detects A → B → A cycle', () => {
        const a: Artifact<number> = artifact(({ get }) => {
            return get(b as Artifact<number>) + 1;
        });

        const b: Artifact<number> = artifact(({ get }) => {
            return get(a as Artifact<number>) + 1;
        });

        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);
    });

    it('detects self-cycle via get(self)', () => {
        const recursive: Artifact<number> = artifact(({ get }) => {
            return get(recursive as Artifact<number>) + 1;
        });

        expect(() => readArtifact(recursive)).toThrow(/Circular dependency detected/);
    });

    it('detects A → B → C → A cycle', () => {
        const a: Artifact<number> = artifact(({ get }) => {
            return get(b as Artifact<number>) * 2;
        });

        const b: Artifact<number> = artifact(({ get }) => {
            return get(c as Artifact<number>) + 5;
        });

        const c: Artifact<number> = artifact(({ get }) => {
            return get(a as Artifact<number>) - 3;
        });

        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);
    });

    it('allows diamond dependencies (A←B, A←C, D reads B+C)', () => {
        const a = artifact(10);
        
        const b = artifact(({ get }) => {
            return get(a) * 2;
        });

        const c = artifact(({ get }) => {
            return get(a) + 5;
        });

        const d = artifact(({ get }) => {
            return get(b) + get(c);
        });

        // Should not throw - this is a valid DAG, not a cycle
        expect(readArtifact(d)).toBe(35); // (10*2) + (10+5) = 20 + 15 = 35
    });

    it('cleans up computation stack after error', () => {
        const a: Artifact<number> = artifact(({ get }) => {
            return get(b as Artifact<number>) + 1;
        });

        const b: Artifact<number> = artifact(({ get }) => {
            return get(a as Artifact<number>) + 1;
        });

        // First attempt should detect cycle
        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);

        // Second attempt should also detect cycle (stack should be clean)
        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);
    });

    it('cleans up computation stack after successful computation', () => {
        const source = artifact(5);
        
        const derived = artifact(({ get }) => {
            return get(source) * 2;
        });

        // First read should succeed
        expect(readArtifact(derived)).toBe(10);

        // Update source to trigger recomputation
        writeArtifact(source, 7);

        // Second read should also succeed (stack should be clean)
        expect(readArtifact(derived)).toBe(14);
    });

    it('detects cycle after successful first computation then dependency change creating cycle', () => {
        const toggle = artifact(false);
        const a: Artifact<number> = artifact(({ get }) => {
            const useB = get(toggle);
            if (useB) {
                return get(b as Artifact<number>) + 1;
            }
            return 10;
        });

        const b: Artifact<number> = artifact(({ get }) => {
            return get(a as Artifact<number>) * 2;
        });

        // Initially, a doesn't depend on b, so no cycle
        expect(readArtifact(a)).toBe(10);
        expect(readArtifact(b)).toBe(20);

        // Now create a cycle by toggling - this triggers recomputation of a
        writeArtifact(toggle, true);

        // The cycle is detected when we try to read a, causing it to be rejected
        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);
    });

    it('provides helpful error message with artifact key', () => {
        const self: Artifact<any> = artifact(({ get }) => {
            return get(self as Artifact<any>);
        });

        try {
            readArtifact(self);
            expect.fail('Should have thrown');
        } catch (error) {
            const message = (error as Error).message;
            expect(message).toMatch(/Circular dependency detected/);
            expect(message).toMatch(/artifact with key/);
            expect(message).toMatch(/is part of a dependency cycle/);
            expect(message).toMatch(/Check your artifact initializers/);
        }
    });

    it('detects cycle in parameterized artifacts', () => {
        const factorial: any = artifact(({ get, n }: { get: any; n: number }) => {
            if (n <= 1) return 1;
            // This creates a cycle if we try to compute factorial(5) which tries to get factorial(5)
            return n * get(factorial({ n }));
        });

        expect(() => readArtifact(factorial({ n: 5 }))).toThrow(/Circular dependency detected/);
    });

    it('allows derived artifact reading from static artifact (non-cycle)', () => {
        const counter = artifact(5);
        
        const computed = artifact(({ get }) => {
            const n = get(counter);
            // This is not a circular dependency - it reads counter, not itself
            return n * 2;
        });

        expect(readArtifact(computed)).toBe(10);
        
        writeArtifact(counter, 10);
        expect(readArtifact(computed)).toBe(20);
    });

    it('detects cycle when chain includes static artifact', () => {
        const static_val = artifact(100);
        
        const a: Artifact<number> = artifact(({ get }) => {
            return get(static_val) + get(b as Artifact<number>);
        });

        const b: Artifact<number> = artifact(({ get }) => {
            return get(a as Artifact<number>) * 2;
        });

        expect(() => readArtifact(a)).toThrow(/Circular dependency detected/);
    });

    it('handles multiple independent cycles without interference', () => {
        // First cycle: a1 → b1 → a1
        const a1: Artifact<number> = artifact(({ get }) => get(b1 as Artifact<number>) + 1);
        const b1: Artifact<number> = artifact(({ get }) => get(a1 as Artifact<number>) + 1);

        // Second cycle: a2 → b2 → a2
        const a2: Artifact<number> = artifact(({ get }) => get(b2 as Artifact<number>) + 1);
        const b2: Artifact<number> = artifact(({ get }) => get(a2 as Artifact<number>) + 1);

        // Both should throw independently
        expect(() => readArtifact(a1)).toThrow(/Circular dependency detected/);
        expect(() => readArtifact(a2)).toThrow(/Circular dependency detected/);
    });
});
