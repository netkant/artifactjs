import { use, useCallback, useEffect, useMemo, useReducer } from 'react';

const ARTIFACT_REF = Symbol('artifact-ref');
const DEFAULT_KEY = '__default__';

function createFamily(initializer, options = {}) {
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

function isArtifactRef(value) {
    return Boolean(value?.[ARTIFACT_REF]);
}

function createArtifactRef(family, args = []) {
    return {
        [ARTIFACT_REF]: true,
        family,
        args,
        key: createCacheKey(args),
    };
}

function createCacheKey(args) {
    if (args.length === 0) {
        return DEFAULT_KEY;
    }

    try {
        return JSON.stringify(args);
    } catch {
        return args.map((arg) => String(arg)).join('|');
    }
}

function isThenable(value) {
    return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !isThenable(value);
}

function ensureArtifactRef(candidate) {
    if (!isArtifactRef(candidate)) {
        throw new Error('Expected an artifact reference. Pass artifact(...) or artifactFactory(...args).');
    }

    return candidate;
}

function isExpired(state, family) {
    const { maxAge } = family.options;

    if (!Number.isFinite(maxAge) || state.status !== 'resolved') {
        return false;
    }

    return Date.now() - state.updatedAt > maxAge;
}

function clearRevalidateTimer(state) {
    if (state.revalidateTimer != null) {
        clearTimeout(state.revalidateTimer);
        state.revalidateTimer = undefined;
    }
}

function scheduleRevalidate(state) {
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

function revalidateState(state, artifactRef) {
    if (state.status === 'pending') {
        return;
    }

    clearRevalidateTimer(state);
    hydrateStateFromInitializer(state, artifactRef);
    notify(state);
}

function getOrCreateState(artifactRef) {
    const cached = artifactRef.family.instances.get(artifactRef.key);

    if (cached) {
        if (isExpired(cached, artifactRef.family)) {
            revalidateState(cached, artifactRef);
        }

        return cached;
    }

    const state = {
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
    };

    artifactRef.family.instances.set(artifactRef.key, state);

    hydrateStateFromInitializer(state, artifactRef);

    return state;
}

function teardownDeps(state) {
    if (state.depCleanups) {
        for (const cleanup of state.depCleanups) {
            cleanup();
        }
    }

    state.dependencies = null;
    state.depCleanups = null;
}

function recomputeDerivedState(state, artifactRef) {
    hydrateStateFromInitializer(state, artifactRef);
    notify(state);
}

function buildInitializerArg(get, artifactRef) {
    const userArg = artifactRef.args[0];

    if (isPlainObject(userArg)) {
        return { get, ...userArg };
    }

    return { get };
}

function runInitializer(initializer, artifactRef) {
    const pendingDeps = [];
    const depStates = new Set();
    let result;
    let error;

    const get = (candidate) => {
        const depRef = ensureArtifactRef(candidate);
        const depState = getOrCreateState(depRef);
        depStates.add(depState);

        if (depState.status === 'pending') {
            pendingDeps.push(depState.promise);
            return undefined;
        }

        if (depState.status === 'rejected') {
            throw depState.error;
        }

        return depState.value;
    };

    try {
        result = initializer(buildInitializerArg(get, artifactRef));
    } catch (e) {
        error = e;
    }

    return { result, depStates, pendingDeps, error };
}

function wireDepSubscriptions(state, artifactRef, depStates) {
    if (depStates.size > 0) {
        state.dependencies = depStates;
        state.depCleanups = [...depStates].map((depState) =>
            subscribe(depState, () => recomputeDerivedState(state, artifactRef)),
        );
    }
}

function hydrateStateFromInitializer(state, artifactRef) {
    clearRevalidateTimer(state);

    const { initializer } = artifactRef.family;

    if (typeof initializer !== 'function') {
        applyValue(state, initializer);
        return;
    }

    teardownDeps(state);

    const { result, depStates, pendingDeps, error } = runInitializer(initializer, artifactRef);

    if (pendingDeps.length > 0) {
        state.status = 'pending';
        state.error = undefined;
        state.promise = Promise.all(pendingDeps).then(() => {
            hydrateStateFromInitializer(state, artifactRef);
            notify(state);
            if (state.status === 'pending') return state.promise;
            if (state.status === 'rejected') throw state.error;
            return state.value;
        });
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

function markResolved(state, value) {
    state.status = 'resolved';
    state.value = value;
    state.error = undefined;
    state.promise = undefined;
    state.updatedAt = Date.now();
    scheduleRevalidate(state);
}

function applyValue(state, nextValue) {
    clearRevalidateTimer(state);

    if (isThenable(nextValue)) {
        state.status = 'pending';
        state.error = undefined;
        state.promise = Promise.resolve(nextValue).then(
            (resolvedValue) => {
                markResolved(state, resolvedValue);
                notify(state);
                return resolvedValue;
            },
            (error) => {
                state.status = 'rejected';
                state.error = error;
                state.promise = undefined;
                notify(state);
                throw error;
            },
        );

        return;
    }

    markResolved(state, nextValue);
}

function subscribe(state, listener) {
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

function notify(state) {
    const snapshot = [...state.listeners];

    for (const listener of snapshot) {
        listener();
    }
}

function readState(state) {
    if (state.status === 'pending') {
        return use(state.promise);
    }

    if (state.status === 'rejected') {
        throw state.error;
    }

    return state.value;
}

function writeState(state, nextValueOrUpdater) {
    const currentValue = state.status === 'resolved' ? state.value : undefined;
    const nextValue =
        typeof nextValueOrUpdater === 'function' ? nextValueOrUpdater(currentValue) : nextValueOrUpdater;

    applyValue(state, nextValue);
    notify(state);
}

export function artifactWithStorage(key, initialValue, options = {}) {
    const { storage: getStorage = () => localStorage, serialize = JSON.stringify, deserialize = JSON.parse } = options;

    function resolveStorage() {
        return typeof getStorage === 'function' ? getStorage() : getStorage;
    }

    function readFromStorage() {
        try {
            const item = resolveStorage().getItem(key);
            return item !== null ? deserialize(item) : initialValue;
        } catch {
            return initialValue;
        }
    }

    function writeToStorage(value) {
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

        writeToStorage(state.value);
    });

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', (event) => {
            if (event.key !== key || event.storageArea !== resolveStorage()) {
                return;
            }

            try {
                const next = event.newValue !== null ? deserialize(event.newValue) : initialValue;

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

export function artifact(initializer, options = {}) {
    const family = createFamily(initializer, options);

    if (typeof initializer === 'function') {
        const factory = (...args) => createArtifactRef(family, args);

        return Object.assign(factory, createArtifactRef(family));
    }

    return createArtifactRef(family);
}

export function useArtifactValue(candidate) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    const [, forceRerender] = useReducer((value) => value + 1, 0);

    useEffect(() => subscribe(state, forceRerender), [state]);

    return readState(state);
}

export function useSetArtifact(candidate) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    return useCallback((nextValueOrUpdater) => {
        writeState(state, nextValueOrUpdater);
    }, [state]);
}

export function useResetArtifact(candidate) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);

    return useCallback(() => {
        clearRevalidateTimer(state);
        hydrateStateFromInitializer(state, artifactRef);
        notify(state);
    }, [state, artifactRef]);
}

export function useArtifact(candidate) {
    const value = useArtifactValue(candidate);
    const setValue = useSetArtifact(candidate);
    const resetValue = useResetArtifact(candidate);

    return useMemo(() => [value, setValue, resetValue], [value, setValue, resetValue]);
}

export function resetArtifact(candidate) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    clearRevalidateTimer(state);
    hydrateStateFromInitializer(state, artifactRef);
    notify(state);
}

export function readArtifact(candidate) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    if (state.status === 'rejected') throw state.error;
    return state.value;
}

export function writeArtifact(candidate, value) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    writeState(state, value);
}

export function subscribeArtifact(candidate, listener) {
    const artifactRef = ensureArtifactRef(candidate);
    const state = getOrCreateState(artifactRef);
    return subscribe(state, listener);
}
