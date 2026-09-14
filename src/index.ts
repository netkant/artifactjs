import { useCallback, useSyncExternalStore } from 'react';

const ARTIFACT_REF = Symbol('artifact-ref');
const DEFAULT_KEY = '__default__';

/** Cache freshness options for `artifact()`. */
export interface ArtifactOptions {
    maxAge?: number;
    revalidate?: 'on-read' | 'auto';

}

/** Options for `artifactWithStorage()`. */
export interface ArtifactStorageOptions<T> {
    storage?: Storage | (() => Storage);
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
}

/** Read another artifact from inside an initializer (derived artifacts). */
export type ArtifactGet = <T>(ref: Artifact<T>) => T;

/** Argument passed to function initializers: `{ get }` plus any call-site params. */
export type ArtifactInitializerArg<P extends object = object> = { get: ArtifactGet } & P;

type ResolvedOptions = {
    maxAge: number;
    revalidate: 'on-read' | 'auto';
};

type Listener = () => void;

type ArtifactFamily = {
    initializer: unknown;
    options: ResolvedOptions;
    instances: Map<string, ArtifactState>;
};

/**
 * A shared-state reference created by `artifact()` / `artifactWithStorage()`.
 * The `__value` field is a phantom type used only for TypeScript inference.
 */
export type Artifact<T = unknown> = {
    readonly [ARTIFACT_REF]: true;
    readonly family: ArtifactFamily;
    readonly args: unknown[];
    readonly key: string;
    readonly __value?: T;
};

/** Function artifact that is also usable as a default (no-args) reference. */
export type ArtifactFactory<T, P extends object = object> = ((params?: P) => Artifact<T>) & Artifact<T>;

export type ArtifactUpdater<T> = T | ((current: T | undefined) => T);

type InitScratch = { get: ArtifactGet };

type ArtifactState = {
    artifactRef: Artifact;
    listeners: Set<Listener>;
    status: 'resolved' | 'pending' | 'rejected';
    value: unknown;
    error: unknown;
    promise: Promise<unknown> | undefined;
    dependencies: Set<ArtifactState> | null;
    depCleanups: Array<() => void> | null;
    updatedAt: number;
    revalidateTimer: ReturnType<typeof setTimeout> | undefined;
    initScratch: InitScratch | null;
};

function createFamily(initializer: unknown, options: ArtifactOptions = {}): ArtifactFamily {
    return {
        initializer,
        options: {
            maxAge: Infinity,
            revalidate: 'on-read',
            ...options,
        },
        instances: new Map(),
    };
}

function isArtifactRef(value: unknown): value is Artifact {
    return Boolean(
        value &&
            (typeof value === 'object' || typeof value === 'function') &&
            ARTIFACT_REF in (value as object) &&
            (value as Artifact)[ARTIFACT_REF],
    );
}

function createArtifactRef(family: ArtifactFamily, args: unknown[] = []): Artifact {
    return {
        [ARTIFACT_REF]: true,
        family,
        args,
        key: createCacheKey(args),
    };
}

function createCacheKey(args: unknown[]): string {
    if (args.length === 0) {
        return DEFAULT_KEY;
    }

    try {
        return JSON.stringify(args);
    } catch {
        return args.map((arg) => String(arg)).join('|');
    }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return value !== null && typeof value === 'object' && typeof (value as PromiseLike<unknown>).then === 'function';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !isThenable(value);
}

function ensureArtifactRef<T>(candidate: Artifact<T>): Artifact<T>;
function ensureArtifactRef(candidate: unknown): Artifact;
function ensureArtifactRef(candidate: unknown): Artifact {
    if (!isArtifactRef(candidate)) {
        throw new Error('Expected an artifact reference. Pass artifact(...) or artifactFactory(...args).');
    }

    return candidate;
}

function isExpired(state: ArtifactState, family: ArtifactFamily): boolean {
    const { maxAge } = family.options;

    if (!Number.isFinite(maxAge) || state.status !== 'resolved') {
        return false;
    }

    return Date.now() - state.updatedAt > maxAge;
}

function clearRevalidateTimer(state: ArtifactState): void {
    if (state.revalidateTimer != null) {
        clearTimeout(state.revalidateTimer);
        state.revalidateTimer = undefined;
    }
}

function scheduleRevalidate(state: ArtifactState): void {
    clearRevalidateTimer(state);

    const artifactRef = state.artifactRef;
    const { maxAge, revalidate } = artifactRef.family.options;

    if (revalidate !== 'auto' || !Number.isFinite(maxAge)) {
        return;
    }

    if (state.listeners.size === 0 || state.status !== 'resolved') {
        return;
    }

    const delay = Math.max(0, maxAge - (Date.now() - state.updatedAt));

    state.revalidateTimer = setTimeout(() => {
        state.revalidateTimer = undefined;

        if (state.listeners.size === 0) {
            return;
        }

        revalidateState(state, artifactRef);
    }, delay);
}

function revalidateState(state: ArtifactState, artifactRef: Artifact): void {
    if (state.status === 'pending') {
        return;
    }

    const prevStatus = state.status;
    const prevValue = state.value;
    clearRevalidateTimer(state);
    hydrateStateFromInitializer(state, artifactRef);

    if (state.status !== prevStatus || !Object.is(state.value, prevValue)) {
        notify(state);
    }
}

function getOrCreateState(artifactRef: Artifact): ArtifactState {
    const cached = artifactRef.family.instances.get(artifactRef.key);

    if (cached) {
        if (isExpired(cached, artifactRef.family)) {
            revalidateState(cached, artifactRef);
        }

        return cached;
    }

    const state: ArtifactState = {
        artifactRef,
        listeners: new Set(),
        status: 'resolved',
        value: undefined,
        error: undefined,
        promise: undefined,
        dependencies: null,
        depCleanups: null,
        updatedAt: 0,
        revalidateTimer: undefined,
        initScratch: null,
    };

    artifactRef.family.instances.set(artifactRef.key, state);

    hydrateStateFromInitializer(state, artifactRef);

    return state;
}

function teardownDeps(state: ArtifactState): void {
    if (state.depCleanups) {
        for (const cleanup of state.depCleanups) {
            cleanup();
        }
    }

    state.dependencies = null;
    state.depCleanups = null;
}

function sameDepSet(previous: Set<ArtifactState> | null, next: Set<ArtifactState>): boolean {
    if (!previous || previous.size !== next.size) {
        return false;
    }

    for (const dep of next) {
        if (!previous.has(dep)) {
            return false;
        }
    }

    return true;
}

function recomputeDerivedState(state: ArtifactState, artifactRef: Artifact): void {
    const { initializer } = artifactRef.family;

    if (typeof initializer !== 'function') {
        return;
    }

    const { result, depStates, pendingDeps, error } = runInitializer(
        initializer as (arg: ArtifactInitializerArg) => unknown,
        artifactRef,
        state,
    );

    if (pendingDeps.length > 0) {
        const prevStatus = state.status;
        const prevValue = state.value;
        teardownDeps(state);
        hydrateStateFromInitializer(state, artifactRef);
        if (state.status !== prevStatus || !Object.is(state.value, prevValue)) {
            notify(state);
        }
        return;
    }

    const depsChanged = !sameDepSet(state.dependencies, depStates);

    if (depsChanged) {
        teardownDeps(state);
    }

    if (error) {
        const statusChanged = state.status !== 'rejected' || state.error !== error;
        state.status = 'rejected';
        state.error = error;
        if (depsChanged) {
            wireDepSubscriptions(state, artifactRef, depStates);
        }
        if (statusChanged || depsChanged) {
            notify(state);
        }
        return;
    }

    const changed = applyValue(state, result);
    if (depsChanged) {
        wireDepSubscriptions(state, artifactRef, depStates);
    }
    if (changed) {
        notify(state);
    }
}

function buildInitializerArg(
    get: ArtifactGet,
    artifactRef: Artifact,
    scratch: InitScratch | null,
): ArtifactInitializerArg {
    const userArg = artifactRef.args[0];

    if (isPlainObject(userArg)) {
        return { get, ...userArg };
    }

    if (scratch) {
        scratch.get = get;
        return scratch;
    }

    return { get };
}

function runInitializer(
    initializer: (arg: ArtifactInitializerArg) => unknown,
    artifactRef: Artifact,
    state?: ArtifactState,
) {
    const pendingDeps: Promise<unknown>[] = [];
    const depStates = new Set<ArtifactState>();
    let result: unknown;
    let error: unknown;

    const get: ArtifactGet = (candidate) => {
        const depRef = ensureArtifactRef(candidate);
        const depState = getOrCreateState(depRef);
        depStates.add(depState);

        if (depState.status === 'pending') {
            pendingDeps.push(depState.promise!);
            return undefined as never;
        }

        if (depState.status === 'rejected') {
            throw depState.error;
        }

        return depState.value as never;
    };

    let scratch: InitScratch | null = null;
    if (state && artifactRef.args.length === 0) {
        if (!state.initScratch) {
            state.initScratch = { get };
        }
        scratch = state.initScratch;
    }

    try {
        result = initializer(buildInitializerArg(get, artifactRef, scratch));
    } catch (e) {
        error = e;
    }

    return { result, depStates, pendingDeps, error };
}

function wireDepSubscriptions(state: ArtifactState, artifactRef: Artifact, depStates: Set<ArtifactState>): void {
    if (depStates.size === 0) {
        return;
    }

    state.dependencies = depStates;
    const cleanups: Array<() => void> = [];
    for (const depState of depStates) {
        cleanups.push(subscribe(depState, () => recomputeDerivedState(state, artifactRef)));
    }
    state.depCleanups = cleanups;
}

function hydrateStateFromInitializer(state: ArtifactState, artifactRef: Artifact): void {
    clearRevalidateTimer(state);

    const { initializer } = artifactRef.family;

    if (typeof initializer !== 'function') {
        applyValue(state, initializer);
        return;
    }

    teardownDeps(state);

    const { result, depStates, pendingDeps, error } = runInitializer(
        initializer as (arg: ArtifactInitializerArg) => unknown,
        artifactRef,
        state,
    );

    if (pendingDeps.length > 0) {
        state.status = 'pending';
        state.error = undefined;
        state.promise = Promise.all(pendingDeps).then(
            () => {
                hydrateStateFromInitializer(state, artifactRef);
                notify(state);
                if (state.status === 'pending') return state.promise;
                if (state.status === 'rejected') throw state.error;
                return state.value;
            },
            (error: unknown) => {
                state.status = 'rejected';
                state.error = error;
                state.promise = undefined;
                notify(state);
                throw error;
            },
        );
        // Avoid unhandled rejection when only imperative readers are attached
        state.promise.catch(() => {});
        return;
    }

    if (error) {
        state.status = 'rejected';
        state.error = error;
        wireDepSubscriptions(state, artifactRef, depStates);
        return;
    }

    applyValue(state, result);
    wireDepSubscriptions(state, artifactRef, depStates);
}

function markResolved(state: ArtifactState, value: unknown): void {
    state.status = 'resolved';
    state.value = value;
    state.error = undefined;
    state.promise = undefined;
    state.updatedAt = Date.now();
    scheduleRevalidate(state);
}

/** Apply a value. Returns false when the sync resolved value is unchanged (Object.is). */
function applyValue(state: ArtifactState, nextValue: unknown): boolean {
    if (isThenable(nextValue)) {
        clearRevalidateTimer(state);
        state.status = 'pending';
        state.error = undefined;
        state.promise = Promise.resolve(nextValue).then(
            (resolvedValue) => {
                if (state.status === 'resolved' && Object.is(state.value, resolvedValue)) {
                    return resolvedValue;
                }
                markResolved(state, resolvedValue);
                notify(state);
                return resolvedValue;
            },
            (error: unknown) => {
                state.status = 'rejected';
                state.error = error;
                state.promise = undefined;
                notify(state);
                throw error;
            },
        );
        // Avoid unhandled rejection when only imperative readers are attached
        state.promise.catch(() => {});

        return true;
    }

    if (state.status === 'resolved' && Object.is(state.value, nextValue)) {
        return false;
    }

    clearRevalidateTimer(state);
    markResolved(state, nextValue);
    return true;
}

function subscribe(state: ArtifactState, listener: Listener): () => void {
    state.listeners.add(listener);

    if (isExpired(state, state.artifactRef.family)) {
        revalidateState(state, state.artifactRef);
    } else {
        scheduleRevalidate(state);
    }

    return () => {
        state.listeners.delete(listener);

        if (state.listeners.size === 0) {
            clearRevalidateTimer(state);
        }
    };
}

function notify(state: ArtifactState): void {
    const { listeners } = state;

    if (listeners.size === 0) {
        return;
    }

    if (listeners.size === 1) {
        for (const listener of listeners) {
            listener();
        }
        return;
    }

    const snapshot = [...listeners];
    for (const listener of snapshot) {
        listener();
    }
}

function writeState<T>(state: ArtifactState, nextValueOrUpdater: ArtifactUpdater<T>): void {
    const currentValue = state.status === 'resolved' ? (state.value as T) : undefined;
    const nextValue =
        typeof nextValueOrUpdater === 'function'
            ? (nextValueOrUpdater as (current: T | undefined) => T)(currentValue)
            : nextValueOrUpdater;

    if (applyValue(state, nextValue)) {
        notify(state);
    }
}

function resetState(state: ArtifactState, artifactRef: Artifact): void {
    const { initializer } = artifactRef.family;

    if (typeof initializer !== 'function') {
        writeState(state, initializer as never);
        return;
    }

    const prevStatus = state.status;
    const prevValue = state.value;
    clearRevalidateTimer(state);
    hydrateStateFromInitializer(state, artifactRef);

    if (state.status !== prevStatus || !Object.is(state.value, prevValue)) {
        notify(state);
    }
}

/** Create an artifact persisted to `localStorage` / `sessionStorage` with cross-tab sync.
 *  When `initialValue` is omitted, the fallback is `undefined`.
 */
export function artifactWithStorage<T = undefined>(
    key: string,
    initialValue?: T,
    options: ArtifactStorageOptions<T> = {},
): Artifact<T> {
    const fallback = initialValue as T;
    const {
        storage: getStorage = () => localStorage,
        serialize = JSON.stringify as (value: T) => string,
        deserialize = JSON.parse as (value: string) => T,
    } = options;

    function resolveStorage(): Storage {
        return typeof getStorage === 'function' ? getStorage() : getStorage;
    }

    function readFromStorage(): T {
        try {
            const item = resolveStorage().getItem(key);
            return item !== null ? deserialize(item) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeToStorage(value: T): void {
        try {
            resolveStorage().setItem(key, serialize(value));
        } catch {
            // Storage full or unavailable
        }
    }

    const base = artifact(readFromStorage());
    const state = getOrCreateState(base);

    let syncing = false;

    subscribe(state, () => {
        if (syncing || state.status !== 'resolved') {
            return;
        }

        writeToStorage(state.value as T);
    });

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', (event) => {
            if (event.key !== key || event.storageArea !== resolveStorage()) {
                return;
            }

            try {
                const next = event.newValue !== null ? deserialize(event.newValue) : fallback;

                syncing = true;
                writeState(state, next);
                syncing = false;
            } catch {
                syncing = false;
            }
        });
    }

    return base;
}

/** Create an artifact from an initializer / derived / parameterized function. */
export function artifact<T, P extends object = object>(
    initializer: (arg: ArtifactInitializerArg<P>) => T | Promise<T>,
    options?: ArtifactOptions,
): ArtifactFactory<T, P>;
/** Create an artifact from a Promise (fetches immediately on module load). */
export function artifact<T>(promise: Promise<T>, options?: ArtifactOptions): Artifact<T>;
/** Create an artifact from a static value. */
export function artifact<T>(value: T, options?: ArtifactOptions): Artifact<T>;
export function artifact(initializer: unknown, options: ArtifactOptions = {}): Artifact | ArtifactFactory<unknown> {
    const family = createFamily(initializer, options);

    if (typeof initializer === 'function') {
        const factory = (...args: unknown[]) => createArtifactRef(family, args);

        return Object.assign(factory, createArtifactRef(family));
    }

    return createArtifactRef(family);
}

/** Read the current value and subscribe — this component re-renders on change. */
export function useArtifactValue<T>(candidate: Artifact<T>): T {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    const subscribeToStore = useCallback((onStoreChange: () => void) => subscribe(state, onStoreChange), [state]);
    const getSnapshot = useCallback(() => {
        if (state.status === 'pending') {
            if (!state.promise) {
                throw new Error('Pending artifact is missing a promise');
            }
            // Suspend via Suspense (must stay consistent across renders — do not mix with use()).
            throw state.promise;
        }
        if (state.status === 'rejected') {
            throw state.error;
        }
        return state.value as T;
    }, [state]);

    return useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);
}

/** Return a setter without subscribing in this component. */
export function useSetArtifact<T>(candidate: Artifact<T>): (nextValueOrUpdater: ArtifactUpdater<T>) => void {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    return useCallback(
        (nextValueOrUpdater: ArtifactUpdater<T>) => {
            writeState(state, nextValueOrUpdater);
        },
        [state],
    );
}

/** Return a reset function — restores initial value or re-fetches. */
export function useResetArtifact<T>(candidate: Artifact<T>): () => void {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    return useCallback(() => {
        resetState(state, artifactRef);
    }, [state, artifactRef]);
}

/** Returns `[value, setValue, resetValue]` — like `useState` with reset. */
export function useArtifact<T>(
    candidate: Artifact<T>,
): [T, (nextValueOrUpdater: ArtifactUpdater<T>) => void, () => void] {
    const value = useArtifactValue(candidate);
    const setValue = useSetArtifact(candidate);
    const resetValue = useResetArtifact(candidate);

    return [value, setValue, resetValue];
}

/** Reset to initial value outside React. */
export function resetArtifact<T>(candidate: Artifact<T>): void {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    resetState(state, artifactRef);
}

/** Read the current value synchronously outside React. */
export function readArtifact<T>(candidate: Artifact<T>): T | undefined {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    if (state.status === 'rejected') throw state.error;
    return state.value as T | undefined;
}

/** Write a value outside React. */
export function writeArtifact<T>(candidate: Artifact<T>, value: ArtifactUpdater<T>): void {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    writeState(state, value);
}

/** Subscribe to changes outside React. Returns an unsubscribe function. */
export function subscribeArtifact<T>(candidate: Artifact<T>, listener: Listener): () => void {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    return subscribe(state, listener);
}
