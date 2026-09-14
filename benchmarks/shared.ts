export const ITERATIONS = 100_000;
export const SUBSCRIBERS = 1000;

export type BenchRow = {
    operation: string;
    jotaiMs: number;
    artifactMs: number;
};

export function roundMs(ms: number): number {
    return Math.round(ms * 100) / 100;
}

export function outcome(jotaiMs: number, artifactMs: number): string {
    if (artifactMs === 0 && jotaiMs === 0) {
        return 'tie';
    }
    if (artifactMs < jotaiMs) {
        const pct = Math.round(((jotaiMs - artifactMs) / jotaiMs) * 100);
        return `${pct}% faster`;
    }
    if (artifactMs > jotaiMs) {
        const pct = Math.round(((artifactMs - jotaiMs) / jotaiMs) * 100);
        return `${pct}% slower`;
    }
    return 'tie';
}

export function printTable(title: string, rows: BenchRow[]): void {
    console.log(`\n${title}`);
    console.log('-'.repeat(title.length));

    const header = [
        pad('Operation', 22),
        pad('Jotai (ms)', 12, true),
        pad('Artifact (ms)', 14, true),
        pad('Outcome', 14, true),
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const row of rows) {
        const jotai = roundMs(row.jotaiMs);
        const artifact = roundMs(row.artifactMs);
        console.log(
            [
                pad(row.operation, 22),
                pad(jotai.toFixed(2), 12, true),
                pad(artifact.toFixed(2), 14, true),
                pad(outcome(jotai, artifact), 14, true),
            ].join('  '),
        );
    }
    console.log('');
}

function pad(value: string, width: number, right = false): string {
    if (value.length >= width) {
        return value;
    }
    const spaces = ' '.repeat(width - value.length);
    return right ? spaces + value : value + spaces;
}
