import { JSDOM } from 'jsdom';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import React, { act, memo, useEffect, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    artifact,
    useArtifactValue,
    useResetArtifact,
    useSetArtifact,
} from '../src/index';
import { printTable, SUBSCRIBERS, type BenchRow } from './shared';

function setupDom(): void {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
        url: 'http://localhost/',
    });

    const { window } = dom;
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'Node', { value: window.Node, configurable: true });
    Object.defineProperty(globalThis, 'MutationObserver', {
        value: window.MutationObserver,
        configurable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
        value: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
        configurable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        value: (id: number) => clearTimeout(id),
        configurable: true,
    });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        value: true,
        configurable: true,
    });
}

setupDom();

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

async function afterFrames(frames: number): Promise<void> {
    for (let i = 0; i < frames; i += 1) {
        await act(async () => {
            await nextFrame();
        });
    }
}

function mount(element: ReactNode): { root: Root; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(element);
    });
    return { root, container };
}

function unmount(root: Root, container: HTMLElement): void {
    act(() => {
        root.unmount();
    });
    container.remove();
}

// Write benchmark — shared refs (same pattern as app benchmark.jsx)
const sharedJotaiAtom = atom(0);
const sharedArtifactRef = artifact(0);

const JotaiWriteSubscriber = memo(function JotaiWriteSubscriber() {
    const value = useAtomValue(sharedJotaiAtom);
    return <span style={{ display: 'none' }}>{value}</span>;
});

const ArtifactWriteSubscriber = memo(function ArtifactWriteSubscriber() {
    const value = useArtifactValue(sharedArtifactRef);
    return <span style={{ display: 'none' }}>{value}</span>;
});

function JotaiWriteBenchmark({
    count,
    onDone,
}: {
    count: number;
    onDone: (ms: number) => void;
}) {
    const setJotaiAtom = useSetAtom(sharedJotaiAtom);

    useEffect(() => {
        void (async () => {
            await afterFrames(1);
            const t0 = performance.now();
            act(() => {
                setJotaiAtom((v) => v + 1);
            });
            await afterFrames(1);
            onDone(performance.now() - t0);
        })();
    }, [setJotaiAtom, onDone]);

    return (
        <div style={{ display: 'none' }}>
            {Array.from({ length: count }, (_, i) => (
                <JotaiWriteSubscriber key={i} />
            ))}
        </div>
    );
}

function ArtifactWriteBenchmark({
    count,
    onDone,
}: {
    count: number;
    onDone: (ms: number) => void;
}) {
    const setArtifactVal = useSetArtifact(sharedArtifactRef);

    useEffect(() => {
        void (async () => {
            await afterFrames(1);
            const t0 = performance.now();
            act(() => {
                setArtifactVal((v) => v + 1);
            });
            await afterFrames(1);
            onDone(performance.now() - t0);
        })();
    }, [setArtifactVal, onDone]);

    return (
        <div style={{ display: 'none' }}>
            {Array.from({ length: count }, (_, i) => (
                <ArtifactWriteSubscriber key={i} />
            ))}
        </div>
    );
}

// Reset benchmark
const resetJotaiAtom = atom(0);
const resetArtifactRef = artifact(0);

const JotaiResetSubscriber = memo(function JotaiResetSubscriber() {
    const value = useAtomValue(resetJotaiAtom);
    return <span style={{ display: 'none' }}>{value}</span>;
});

const ArtifactResetSubscriber = memo(function ArtifactResetSubscriber() {
    const value = useArtifactValue(resetArtifactRef);
    return <span style={{ display: 'none' }}>{value}</span>;
});

function JotaiResetBenchmark({
    count,
    onDone,
}: {
    count: number;
    onDone: (ms: number) => void;
}) {
    const setJotaiAtom = useSetAtom(resetJotaiAtom);

    useEffect(() => {
        void (async () => {
            await afterFrames(1);
            act(() => {
                setJotaiAtom(42);
            });
            await afterFrames(1);
            const t0 = performance.now();
            act(() => {
                setJotaiAtom(0);
            });
            await afterFrames(1);
            onDone(performance.now() - t0);
        })();
    }, [setJotaiAtom, onDone]);

    return (
        <div style={{ display: 'none' }}>
            {Array.from({ length: count }, (_, i) => (
                <JotaiResetSubscriber key={i} />
            ))}
        </div>
    );
}

function ArtifactResetBenchmark({
    count,
    onDone,
}: {
    count: number;
    onDone: (ms: number) => void;
}) {
    const setArtifactVal = useSetArtifact(resetArtifactRef);
    const resetArt = useResetArtifact(resetArtifactRef);

    useEffect(() => {
        void (async () => {
            await afterFrames(1);
            act(() => {
                setArtifactVal(42);
            });
            await afterFrames(1);
            const t0 = performance.now();
            act(() => {
                resetArt();
            });
            await afterFrames(1);
            onDone(performance.now() - t0);
        })();
    }, [setArtifactVal, resetArt, onDone]);

    return (
        <div style={{ display: 'none' }}>
            {Array.from({ length: count }, (_, i) => (
                <ArtifactResetSubscriber key={i} />
            ))}
        </div>
    );
}

function runTimedMount(BenchComponent: ComponentType<{ count: number; onDone: (ms: number) => void }>): Promise<number> {
    return new Promise((resolve) => {
        const { root, container } = mount(
            <BenchComponent
                count={SUBSCRIBERS}
                onDone={(ms) => {
                    unmount(root, container);
                    resolve(ms);
                }}
            />,
        );
    });
}

async function main(): Promise<void> {
    const jotaiWriteMs = await runTimedMount(JotaiWriteBenchmark);
    const artifactWriteMs = await runTimedMount(ArtifactWriteBenchmark);
    const jotaiResetMs = await runTimedMount(JotaiResetBenchmark);
    const artifactResetMs = await runTimedMount(ArtifactResetBenchmark);

    const rows: BenchRow[] = [
        {
            operation: 'Wall time (write)',
            jotaiMs: jotaiWriteMs,
            artifactMs: artifactWriteMs,
        },
        {
            operation: 'Wall time (reset)',
            jotaiMs: jotaiResetMs,
            artifactMs: artifactResetMs,
        },
    ];

    printTable(`React render benchmark (${SUBSCRIBERS} subscribers)`, rows);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
