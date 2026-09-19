import { useCallback, useRef, useSyncExternalStore } from 'react';

const ARTIFACT_REF = Symbol('artifact-ref');
const DEFAULT_KEY = '__default__';
const STORAGE_KEYS = new Set<string>();

/** Cache freshness options for `artifact()`. */
export interface ArtifactOptions {
    maxAge?: number;
    revalidate?: 'on-read' | 'auto';
    /** Stable cache key for parameterized instances. Default: deterministic JSON.stringify with sorted object keys. */
    key?: (params: any) => string;
    /** Soft LRU cap on parameterized instances. Default: Infinity (unlimited). Opt-in to a finite limit by setting a number. Set to false to explicitly disable. Evicts only unsubscribed, non-pending instances. */
    maxEntries?: number | false;
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
    key?: (params: any) => string;
    maxEntries: number;
};

type Listener = () => void;

type ArtifactFamily = {
    initializer: unknown;
    options: ResolvedOptions;
    instances: Map<string, ArtifactState>;
    lruOrder: string[];
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

export type ArtifactUpdater<T> = T | Promise<T> | ((current: T | undefined) => T | Promise<T>);

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
    generation: number;
};

function createFamily(initializer: unknown, options: ArtifactOptions = {}): ArtifactFamily {
    // Ensure maxEntries is a number (convert false to Infinity if needed)
    const maxEntries: number = options.maxEntries === false ? Infinity : (options.maxEntries ?? Infinity);
    
    return {
        initializer,
        options: {
            maxAge: options.maxAge ?? Infinity,
            revalidate: options.revalidate ?? 'on-read',
            key: options.key,
            maxEntries,
        },
        instances: new Map(),
        lruOrder: [],
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

function stableStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    
    // Handle special built-in types
    if (value instanceof Date) {
        return `Date:${value.toISOString()}`;
    }
    if (value instanceof RegExp) {
        return `RegExp:${value.toString()}`;
    }
    if (value instanceof Map) {
        const entries = Array.from(value.entries())
            .map(([k, v]) => [stableStringify(k), stableStringify(v)])
            .sort((a, b) => a[0].localeCompare(b[0]));
        return `Map:[${entries.map(([k, v]) => `[${k},${v}]`).join(',')}]`;
    }
    if (value instanceof Set) {
        const items = Array.from(value)
            .map(stableStringify)
            .sort();
        return `Set:[${items.join(',')}]`;
    }
    
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

function createArtifactRef(family: ArtifactFamily, args: unknown[] = []): Artifact {
    return {
        [ARTIFACT_REF]: true,
        family,
        args,
        key: createCacheKey(family, args),
    };
}

function createCacheKey(family: ArtifactFamily, args: unknown[]): string {
    if (args.length === 0) {
        return DEFAULT_KEY;
    }

    const { key: customKey } = family.options;
    
    if (customKey) {
        const params = args[0];
        if (!isPlainObject(params)) {
            throw new Error('Custom key function requires params to be a plain object');
        }
        return customKey(params as object);
    }

    try {
        return stableStringify(args);
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

function updateLRU(family: ArtifactFamily, key: string): void {
    const { lruOrder } = family;
    const index = lruOrder.indexOf(key);
    
    if (index !== -1) {
        lruOrder.splice(index, 1);
    }
    
    lruOrder.push(key);
}

function evictLRU(family: ArtifactFamily): void {
    const { maxEntries } = family.options;
    const { instances, lruOrder } = family;
    
    if (!Number.isFinite(maxEntries)) {
        return;
    }
    
    // Need to evict before we exceed the limit
    while (instances.size >= maxEntries) {
        let evicted = false;
        
        for (const key of lruOrder) {
            const state = instances.get(key);
            
            // Skip instances with subscribers or pending async operations
            if (!state || state.listeners.size > 0 || state.status === 'pending') {
                continue;
            }
            
            clearRevalidateTimer(state);
            teardownDeps(state);
            instances.delete(key);
            
            const lruIndex = lruOrder.indexOf(key);
            if (lruIndex !== -1) {
                lruOrder.splice(lruIndex, 1);
            }
            
            evicted = true;
            break;
        }
        
        // If we couldn't evict anything (all instances subscribed or pending), stop trying
        if (!evicted) {
            break;
        }
    }
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
        updateLRU(artifactRef.family, artifactRef.key);
        
        if (isExpired(cached, artifactRef.family)) {
            revalidateState(cached, artifactRef);
        }

        return cached;
    }

    evictLRU(artifactRef.family);

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
        generation: 0,
    };

    artifactRef.family.instances.set(artifactRef.key, state);
    updateLRU(artifactRef.family, artifactRef.key);

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
        state.generation++;
        state.status = 'rejected';
        state.error = error;
        state.promise = undefined;
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
        state.generation++;
        const expectedGeneration = state.generation;
        state.promise = Promise.all(pendingDeps).then(
            () => {
                if (state.generation !== expectedGeneration) {
                    if (state.status === 'pending') return state.promise;
                    if (state.status === 'rejected') throw state.error;
                    return state.value;
                }
                hydrateStateFromInitializer(state, artifactRef);
                notify(state);
                if (state.status === 'pending') return state.promise;
                if (state.status === 'rejected') throw state.error;
                return state.value;
            },
            (error: unknown) => {
                if (state.generation !== expectedGeneration) {
                    if (state.status === 'pending') return state.promise;
                    if (state.status === 'rejected') throw state.error;
                    return state.value;
                }
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
        state.generation++;
        state.status = 'rejected';
        state.error = error;
        state.promise = undefined;
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
        state.generation++;
        const expectedGeneration = state.generation;
        state.promise = Promise.resolve(nextValue).then(
            (resolvedValue) => {
                if (state.generation !== expectedGeneration) {
                    if (state.status === 'pending') return state.promise;
                    if (state.status === 'rejected') throw state.error;
                    return state.value;
                }
                if (state.status === 'resolved' && Object.is(state.value, resolvedValue)) {
                    return resolvedValue;
                }
                markResolved(state, resolvedValue);
                notify(state);
                return resolvedValue;
            },
            (error: unknown) => {
                if (state.generation !== expectedGeneration) {
                    if (state.status === 'pending') return state.promise;
                    if (state.status === 'rejected') throw state.error;
                    return state.value;
                }
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
    state.generation++;
    markResolved(state, nextValue);
    return true;
}

function subscribe(state: ArtifactState, listener: Listener): () => void {
    state.listeners.add(listener);
    updateLRU(state.artifactRef.family, state.artifactRef.key);

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
    updateLRU(state.artifactRef.family, state.artifactRef.key);
    
    const currentValue = state.status === 'resolved' ? (state.value as T) : undefined;
    const nextValue =
        typeof nextValueOrUpdater === 'function'
            ? (nextValueOrUpdater as (current: T | undefined) => T | Promise<T>)(currentValue)
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

    const storageBackend = resolveStorage();
    const compositeKey = `${storageBackend === sessionStorage ? 'session' : 'local'}:${key}`;

    if (STORAGE_KEYS.has(compositeKey)) {
        const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
        if (proc && proc.env?.NODE_ENV !== 'production') {
            console.warn(
                `[artifactWithStorage] Duplicate storage key detected: "${key}". ` +
                `Each key should be created only once per application. ` +
                `Same-tab instances with the same key do not sync via the storage event. ` +
                `For more information, see the README.`
            );
        }
    }
    STORAGE_KEYS.add(compositeKey);

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

    const factory = artifact(() => readFromStorage());
    const base = createArtifactRef(factory.family) as Artifact<T>;
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
            } catch {
                // Deserialization or write failure
            } finally {
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
    // Default maxEntries to Infinity (unlimited) for all artifacts
    // Users can opt-in to a finite limit with maxEntries: <number>
    const defaultMaxEntries = Infinity;
    // Treat false as Infinity (disable eviction)
    // Treat invalid values (<= 0, NaN) as Infinity (disable eviction)
    let maxEntries: number;
    if (options.maxEntries === false) {
        maxEntries = Infinity;
    } else if (typeof options.maxEntries === 'number') {
        maxEntries = options.maxEntries <= 0 || !Number.isFinite(options.maxEntries) ? Infinity : options.maxEntries;
    } else {
        maxEntries = defaultMaxEntries;
    }
    
    const resolvedOptions = {
        maxAge: options.maxAge,
        revalidate: options.revalidate,
        key: options.key,
        maxEntries,
    };
    
    const family = createFamily(initializer, resolvedOptions);

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

    // Pin the state in LRU to prevent eviction while this hook is mounted
    // Use useSyncExternalStore with no-op getSnapshot to subscribe without triggering re-renders
    const subscribeToStore = useCallback((onStoreChange: () => void) => subscribe(state, onStoreChange), [state]);
    const getSnapshot = useCallback(() => null, []);
    useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);

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

    // Pin the state in LRU to prevent eviction while this hook is mounted
    // Use useSyncExternalStore with no-op getSnapshot to subscribe without triggering re-renders
    const subscribeToStore = useCallback((onStoreChange: () => void) => subscribe(state, onStoreChange), [state]);
    const getSnapshot = useCallback(() => null, []);
    useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);

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

/**
 * Read the current value synchronously outside React (imperative "peek").
 * 
 * Returns the cached value immediately without suspending or waiting. During revalidation
 * (when an expired artifact is being refreshed), this returns the **stale previous value**
 * rather than waiting for the fresh value.
 * 
 * Use `resolveArtifact()` if you need to wait for the fresh value, or use React hooks
 * (`useArtifactValue`) which suspend during revalidation to show a loading state.
 * 
 * @returns The current value, or `undefined` if the artifact is pending initial load.
 * @throws When the artifact initializer has rejected.
 */
export function readArtifact<T>(candidate: Artifact<T>): T | undefined {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    if (state.status === 'rejected') throw state.error;
    return state.value as T | undefined;
}

/**
 * Wait until an artifact is resolved, then return its value.
 * 
 * If the artifact is currently revalidating (refreshing after expiry), this waits for
 * the **fresh value** rather than returning the stale cached value immediately.
 * 
 * Use this in async contexts (event handlers, async functions, non-React code) when you
 * need the latest data. For synchronous imperative reads that accept stale values during
 * revalidation, use `readArtifact()` instead.
 * 
 * Joins in-flight hydration; rejects if the artifact is/becomes rejected.
 */
export function resolveArtifact<T>(candidate: Artifact<T>): Promise<T> {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    if (state.status === 'resolved') {
        return Promise.resolve(state.value as T);
    }
    if (state.status === 'rejected') {
        return Promise.reject(state.error);
    }
    if (!state.promise) {
        return Promise.reject(new Error('Pending artifact is missing a promise'));
    }
    return state.promise as Promise<T>;
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

/**
 * Get the current status of an artifact.
 * 
 * Returns:
 * - `'pending'` — initializer is running, value not yet available
 * - `'resolved'` — value is available (may be stale during revalidation)
 * - `'rejected'` — initializer threw an error
 * 
 * Use this to implement custom loading states, retry logic, or status-aware UIs.
 * 
 * @example
 * ```ts
 * const status = getArtifactStatus(usersArtifact);
 * if (status === 'pending') {
 *   return <Spinner />;
 * }
 * if (status === 'rejected') {
 *   return <ErrorRetry onRetry={() => resetArtifact(usersArtifact)} />;
 * }
 * return <UserList users={readArtifact(usersArtifact)} />;
 * ```
 */
export function getArtifactStatus<T>(candidate: Artifact<T>): 'pending' | 'resolved' | 'rejected' {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    return state.status;
}

/** Loadable state returned by `useArtifactLoadable`. */
export type ArtifactLoadable<T> =
    | { status: 'pending'; value: undefined; error: undefined }
    | { status: 'resolved'; value: T; error: undefined }
    | { status: 'rejected'; value: undefined; error: unknown };

/**
 * Read an artifact's status, value, and error without suspending or throwing.
 * 
 * Unlike `useArtifactValue` (which suspends on pending and throws on error),
 * this hook returns a loadable object that lets you handle all states explicitly
 * in your component.
 * 
 * Use this for custom loading states, inline error messages, or retry UIs without
 * needing Suspense or Error Boundaries.
 * 
 * @example
 * ```tsx
 * function UserProfile({ userId }) {
 *   const loadable = useArtifactLoadable(userArtifact({ id: userId }));
 *   const reset = useResetArtifact(userArtifact({ id: userId }));
 * 
 *   if (loadable.status === 'pending') {
 *     return <Spinner />;
 *   }
 * 
 *   if (loadable.status === 'rejected') {
 *     return (
 *       <div>
 *         <p>Error: {loadable.error.message}</p>
 *         <button onClick={reset}>Retry</button>
 *       </div>
 *     );
 *   }
 * 
 *   return <div>Hello, {loadable.value.name}!</div>;
 * }
 * ```
 */
export function useArtifactLoadable<T>(candidate: Artifact<T>): ArtifactLoadable<T> {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    // Cache the last loadable to return stable references
    const cacheRef = useRef<{
        generation: number;
        status: string;
        value: unknown;
        error: unknown;
        loadable: ArtifactLoadable<T>;
    } | null>(null);

    const subscribeToStore = useCallback((onStoreChange: () => void) => subscribe(state, onStoreChange), [state]);
    
    const getSnapshot = useCallback(() => {
        // Check if we can reuse the cached loadable
        const cache = cacheRef.current;
        if (
            cache &&
            cache.generation === state.generation &&
            cache.status === state.status &&
            Object.is(cache.value, state.value) &&
            Object.is(cache.error, state.error)
        ) {
            return cache.loadable;
        }

        // Create new loadable
        let loadable: ArtifactLoadable<T>;
        if (state.status === 'pending') {
            loadable = { status: 'pending', value: undefined, error: undefined };
        } else if (state.status === 'rejected') {
            loadable = { status: 'rejected', value: undefined, error: state.error };
        } else {
            loadable = { status: 'resolved', value: state.value as T, error: undefined };
        }

        // Cache it
        cacheRef.current = {
            generation: state.generation,
            status: state.status,
            value: state.value,
            error: state.error,
            loadable,
        };

        return loadable;
    }, [state]);

    return useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);
}
