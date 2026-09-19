# ArtifactJS

A lightweight shared-state library for React 19. Define data once, use it anywhere -- components that read the same artifact share one value and stay in sync automatically.

## Install

```bash
npm install @urlund/artifactjs
```

Peer dependency: React 19+.

## Why?

React state (`useState`) lives inside a single component. If two components need the same data, you either lift state up or pass props down. Artifact removes that wiring: you define a piece of shared state **outside** your components, and any component can read or write it.

## Quick start

```jsx
import { artifact, useArtifact } from '@urlund/artifactjs';

// 1. Define an artifact (outside any component)
const counterArtifact = artifact(0);

// 2. Use it in any component
function Counter() {
    const [count, setCount, resetValue] = useArtifact(counterArtifact);

    return (
        <>
            <button onClick={() => setCount(count + 1)}>Count: {count}</button>
            <button onClick={resetValue}>Reset</button>
        </>
    );
}
```

Every component that calls `useArtifact(counterArtifact)` sees the same value. When one component updates it, all others re-render with the new value.

## Creating artifacts

### Static values

Pass any value directly -- a string, number, array, or object:

```jsx
const nameArtifact = artifact("Alice");
const settingsArtifact = artifact({ theme: "dark", lang: "en" });
const tagsArtifact = artifact(["react", "typescript"]);
```

### Async data (fetched from an API)

Pass a function that returns a Promise. The component will **suspend** (show a loading fallback) until the data arrives:

```jsx
const usersArtifact = artifact(() =>
    fetch("/api/users").then((res) => res.json()),
);
```

Wrap the consuming component in `<Suspense>` to show a fallback while loading:

```jsx
function UserList() {
    const users = useArtifactValue(usersArtifact);

    return users.map((u) => <div key={u.id}>{u.name}</div>);
}

// In a parent:
<Suspense fallback={<div>Loading...</div>}>
    <UserList />
</Suspense>
```

You can also pass a Promise directly without wrapping it in a function:

```jsx
const usersArtifact = artifact(
    fetch("/api/users").then((res) => res.json()),
);
```

The difference: a function runs lazily (on first read), a bare promise starts fetching immediately when the module loads.

### Parameterized artifacts

When you need the same kind of data for different IDs, pass a function that destructures its parameters:

```jsx
const userArtifact = artifact(({ id }) =>
    fetch(`/api/users/${id}`).then((res) => res.json()),
);
```

Then call it with an object to create a specific instance:

```jsx
function UserProfile({ userId }) {
    const user = useArtifactValue(userArtifact({ id: userId }));

    return <h1>{user.name}</h1>;
}
```

Each unique set of parameters gets its own cached value -- `userArtifact({ id: 1 })` and `userArtifact({ id: 2 })` are independent.

#### Cache key and LRU eviction

By default, parameterized instances are cached by a stable JSON representation with sorted object keys -- `{ b: 2, a: 1 }` and `{ a: 1, b: 2 }` share the same instance. **By default, there is no limit** on the number of cached instances. You can opt-in to automatic memory management with the `key` and `maxEntries` options:

```jsx
const userArtifact = artifact(
    ({ id }) => fetch(`/api/users/${id}`).then((res) => res.json()),
    {
        key: ({ id }) => `user:${id}`,
        maxEntries: 500,  // Opt-in to LRU eviction with a finite limit
    },
);
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `key` | Stable `JSON.stringify` with sorted keys | Function that takes params and returns a cache key string |
| `maxEntries` | `Infinity` (unlimited) | Soft LRU cap on parameterized instances. Set to a number to enable automatic eviction. When exceeded, evicts least-recently-used instances that have no active subscribers and are not pending |

#### When to set `maxEntries`

**Why the default is unlimited:** Artifact keeps `maxEntries: Infinity` by default to preserve backward-compatible behavior. This ensures existing code continues to work exactly as it did before the option was introduced. Memory management is opt-in, not automatic.

**When you should set a finite limit:** If your application creates **many unique parameterized instances** over time, you should set `maxEntries` to avoid unbounded memory growth. Common scenarios include:

- **User profiles or feeds** — `userArtifact({ id: userId })` for different users as they browse
- **Post or item detail pages** — `postArtifact({ id: postId })` across many posts
- **Infinite scroll or pagination** — `pageArtifact({ page: n })` accumulating pages over time
- **Route-based caches** — `routeDataArtifact({ path })` for dynamic routing

Without a limit, each unique parameter set stays in memory indefinitely (until page reload), even after the user navigates away.

**Recommended starting values:** For applications with dynamic IDs or unbounded parameter sets, start with **`maxEntries: 200–500`**. This range provides a large enough cache for typical navigation patterns while preventing memory leaks from hundreds or thousands of stale instances. Adjust based on your app's usage:

- **200** — Conservative limit for memory-constrained environments or apps with very large cached values
- **500** — Generous limit for most use cases, balancing memory and cache hit rates

Remember: eviction only removes **unsubscribed, non-pending** instances. Active instances are never evicted, so the cache can temporarily exceed `maxEntries` if all instances are in use.

**Example with finite limit:**

```jsx
// User profile cache with 500-instance limit
const userArtifact = artifact(
    ({ id }) => fetch(`/api/users/${id}`).then((res) => res.json()),
    { maxEntries: 500 },
);

// Post cache with custom key and 300-instance limit
const postArtifact = artifact(
    ({ postId, commentPage = 1 }) =>
        fetch(`/api/posts/${postId}?comments_page=${commentPage}`).then((r) => r.json()),
    {
        key: ({ postId, commentPage }) => `post:${postId}:comments:${commentPage}`,
        maxEntries: 300,
    },
);
```

**Eviction behavior:**

When `maxEntries` is set to a finite number and the limit is reached, Artifact evicts the least-recently-used instance **only if it has no subscribers and is not pending**. Instances are touched (moved to the end of the LRU queue) on every read, write, or subscribe. If all instances have active subscribers or are pending async operations when the limit is reached, no eviction occurs and the cache can temporarily grow beyond `maxEntries`.

Invalid `maxEntries` values (<= 0, NaN) are treated as `Infinity` (unlimited). Setting `maxEntries: false` is an alias for `Infinity`.

Non-parameterized (static or promise) artifacts are unaffected by `maxEntries` and never auto-evict.

### Derived artifacts

An artifact can read from other artifacts using the `get` function. When a dependency changes, the derived artifact recomputes automatically:

```jsx
const todosArtifact = artifact(() =>
    fetch("/api/todos").then((res) => res.json()),
);

const completedTodosArtifact = artifact(({ get }) => {
    const todos = get(todosArtifact);
    return todos.filter((t) => t.completed);
});
```

When `todosArtifact` is updated, `completedTodosArtifact` recalculates and any component reading it re-renders.

### Cache freshness (`maxAge` / `revalidate`)

By default, artifact values live forever (until reset, overwrite, or page unload). Pass options as the second argument to expire and refresh them:

```jsx
// Refresh only when read again after 60s
const usersArtifact = artifact(
    () => fetch("/api/users").then((res) => res.json()),
    { maxAge: 60_000 },
);

// Refresh automatically every 30s while something is subscribed
const liveUsersArtifact = artifact(
    () => fetch("/api/users").then((res) => res.json()),
    { maxAge: 30_000, revalidate: "auto" },
);
```

When a value expires, Artifact hard-refreshes it (same as `resetArtifact`): async readers suspend again until the new value resolves.

**Options:**

| Option | Default | Description |
|---|---|---|
| `maxAge` | `Infinity` | How long (ms) a resolved value stays fresh. Non-finite values disable expiry. |
| `revalidate` | `"on-read"` | `"on-read"` refreshes on the next access after expiry. `"auto"` schedules a timer and refreshes when `maxAge` elapses, but only while at least one listener is subscribed. |

`artifactWithStorage` does not support these options yet.

### Persistent storage

Use `artifactWithStorage` to persist a value to `localStorage` (default) or `sessionStorage`. The stored value is read on creation, written on every update, and synced across browser tabs automatically. The initial value is optional — when omitted (or the key is missing), the value is `undefined`:

**Important:** Each storage key should be created only once per application. If you call `artifactWithStorage` with the same key multiple times in the same tab, those instances will not sync with each other via the `storage` event (the event only fires for changes from other tabs). A console warning will be shown in development when duplicate keys are detected.

```jsx
import { artifactWithStorage } from '@urlund/artifactjs';

// Persists to localStorage by default
const themeArtifact = artifactWithStorage('theme', 'light');

// No default — missing key yields undefined
const tokenArtifact = artifactWithStorage<string | undefined>('CapacitorStorage.token');

// Options without a default: pass undefined as the second argument
const sessionToken = artifactWithStorage('token', undefined, {
    storage: () => sessionStorage,
});

// Use sessionStorage instead
const draftArtifact = artifactWithStorage('draft', '', {
    storage: () => sessionStorage,
});

// Custom serialization for non-JSON types
const tagsArtifact = artifactWithStorage('tags', new Set(), {
    serialize: (v) => JSON.stringify([...v]),
    deserialize: (v) => new Set(JSON.parse(v)),
});
```

The returned artifact works exactly like a regular artifact -- use it with `useArtifact`, `useArtifactValue`, `writeArtifact`, etc.

**Reset behavior:** When you reset a storage artifact (via `resetArtifact` or `useResetArtifact`), it re-reads the current value from storage rather than restoring a create-time snapshot. This ensures reset always syncs with the latest storage state, even if the storage was modified externally (by another tab or process). If the storage key is missing, reset restores the fallback value.

**Options:**

| Option | Default | Description |
|---|---|---|
| `storage` | `() => localStorage` | Function returning the storage backend |
| `serialize` | `JSON.stringify` | Converts the value to a string for storage |
| `deserialize` | `JSON.parse` | Converts the stored string back to a value |

## Reading and writing

### `useArtifact(ref)` -- read + write + reset

Returns a `[value, setValue, resetValue]` tuple:

```jsx
const [theme, setTheme, resetValue] = useArtifact(settingsArtifact);

setTheme({ theme: "light", lang: "en" });
```

The setter also accepts an updater function:

```jsx
setTheme((current) => ({ ...current, theme: "light" }));
```

The reset function restores the initial value (or re-fetches for async artifacts):

```jsx
resetValue();
```

### `useArtifactValue(ref)` — read and subscribe

Returns the current value and subscribes in this component, so it re-renders when the artifact updates:

```jsx
const users = useArtifactValue(usersArtifact);
```

### `useSetArtifact(ref)` — set without subscribing

Returns a setter without subscribing in this component. Subscribed components still re-render when the value changes:

```jsx
const setUsers = useSetArtifact(usersArtifact);
```

### `useResetArtifact(ref)` -- reset to initial value

Returns a function that resets the artifact back to its original state. For static values this restores the initial value; for functions and promises this re-runs the initializer (re-fetches data, recomputes derived values, etc.):

```jsx
const resetUsers = useResetArtifact(usersArtifact);

<button onClick={resetUsers}>Refresh</button>
```

## Using outside React

For use in tests, scripts, or non-React code:

```jsx
import { readArtifact, resolveArtifact, writeArtifact, resetArtifact, subscribeArtifact } from '@urlund/artifactjs';

// Read current value (sync peek — may be undefined while pending)
const value = readArtifact(counterArtifact);

// Wait until resolved (event handlers, scanners, non-React code)
const order = await resolveArtifact(orderState({ id: 42 }));

// Write a new value
writeArtifact(counterArtifact, 42);

// Reset to initial value (re-fetches if async)
resetArtifact(counterArtifact);

// Subscribe to changes (returns an unsubscribe function)
const unsubscribe = subscribeArtifact(counterArtifact, () => {
    console.log("Changed:", readArtifact(counterArtifact));
});

unsubscribe();
```

### Behavior during revalidation

When an artifact with `maxAge` expires and revalidates, React hooks and imperative reads behave differently:

- **React hooks** (`useArtifactValue`, `useArtifact`): **Suspend** during revalidation, showing your `<Suspense>` fallback until the fresh value arrives. This provides a consistent loading experience.

- **Imperative reads** (`readArtifact`): Return the **stale previous value** immediately during revalidation (a synchronous "peek"). This is intentional for non-React code that needs a value right now without awaiting.

- **Promise-based** (`resolveArtifact`): **Waits** for the revalidation to complete and resolves with the fresh value.

**Example:**

```jsx
const users = artifact(() => fetch('/api/users').then(r => r.json()), { maxAge: 60_000 });

// After expiry, during revalidation:

// React hook suspends (shows loading fallback)
const UserList = () => {
    const data = useArtifactValue(users); // Suspends until fresh data arrives
    return <div>{data.length} users</div>;
};

// Imperative read returns stale value immediately
const count = readArtifact(users); // Returns old data during revalidation

// Promise waits for fresh value
const fresh = await resolveArtifact(users); // Waits for new data
```

This design prevents blocking in imperative code (scripts, event handlers, non-React contexts) while preserving Suspense semantics for React components.

## SSR and hydration

ArtifactJS uses React's `useSyncExternalStore` under the hood, which provides built-in support for server-side rendering (SSR) and hydration. Understanding how artifacts behave during SSR is important for building universal React applications.

### Server vs. client snapshots

During SSR, React calls `getServerSnapshot` to determine what value to render on the server. After hydration on the client, React calls `getSnapshot` to get the client-side value and compares them:

- If the values match, hydration succeeds silently
- If they differ, React logs a hydration mismatch warning and performs a client-side re-render to fix the DOM

**Current behavior:** ArtifactJS uses the same snapshot function for both server and client, ensuring consistent behavior:

1. **Static artifacts** (`artifact(42)` or `artifact({ theme: "dark" })`) render the same value on server and client
2. **Async artifacts** suspend on both server and client during pending state, showing the Suspense fallback
3. **Rejected artifacts** throw errors on both server and client, propagating to the nearest Error Boundary
4. **Derived artifacts** that depend only on static or already-resolved artifacts hydrate correctly

### Module-level mutable state

Artifacts store their state in a **module-level mutable store** (`Map` inside each artifact family). This has important SSR implications:

- **On the server:** Module state may persist between requests depending on your framework. **Verify that your runtime isolates or clears module state between requests; do not assume the shared store is request-safe without confirming your framework's behavior.** Some frameworks (e.g., Next.js App Router) aim to provide per-request module isolation, but exact behavior can vary.
- **On the client:** The module is loaded once per page, and artifact state persists for the lifetime of the page (until reload or navigation)
- **Hydration:** The client starts with its own fresh module state. Server-rendered values are not automatically transferred to the client — the client re-initializes each artifact from scratch on mount

**Note:** Basic SSR behavior is covered by `tests/ssr.test.tsx`, which uses `renderToString` in the same process as the client render. The library relies on React's `useSyncExternalStore` for SSR compatibility. These tests do not simulate true multi-request isolation or cross-tab hydration mismatches. If you encounter issues with your SSR framework (especially around per-request module state isolation), please report them on GitHub.

### Storage artifacts and SSR

`artifactWithStorage` reads from `localStorage` (or `sessionStorage`) at **creation time**:

```jsx
const themeArtifact = artifactWithStorage('theme', 'light');
```

This call immediately attempts to read `localStorage.getItem('theme')`. On the server, `localStorage` does not exist, which will cause a runtime error.

**Client-only guidance:**

The recommended approach is to disable SSR for components that use storage artifacts:

```jsx
import dynamic from 'next/dynamic';

// Next.js: disable SSR for this component
const ThemeToggle = dynamic(() => import('./ThemeToggle'), { ssr: false });
```

Inside `ThemeToggle.tsx` (which now only runs on the client), you can safely use lazy initialization:

```jsx
// ThemeToggle.tsx - only runs client-side due to dynamic import above
import { artifactWithStorage, useArtifact } from '@urlund/artifactjs';

let themeArtifact;
function getThemeArtifact() {
    if (!themeArtifact) {
        themeArtifact = artifactWithStorage('theme', 'light');
    }
    return themeArtifact;
}

export default function ThemeToggle() {
    const [theme, setTheme] = useArtifact(getThemeArtifact());
    return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme}</button>;
}
```

**Warning:** Do NOT use `'use client'` with module-level `artifactWithStorage` in Next.js App Router:

```jsx
// ❌ UNSAFE: Module code runs during SSR even in 'use client' components
'use client';
import { artifactWithStorage, useArtifact } from '@urlund/artifactjs';

const themeArtifact = artifactWithStorage('theme', 'light'); // ❌ Crashes on server!

export function ThemeToggle() {
    const [theme, setTheme] = useArtifact(themeArtifact);
    // ...
}
```

The `'use client'` directive only marks the component boundary—module-level code still executes during SSR and will crash when accessing `localStorage`.

### Hydration mismatches

If an artifact's value differs between server render and client mount, React will warn about a hydration mismatch. Common causes:

- **Time-dependent values:** `artifact(new Date())` or `artifact(Math.random())` will differ between server and client
- **Browser APIs:** Artifacts that read `window`, `navigator`, or other client-only globals during initialization
- **Storage artifacts** (if improperly used during SSR, though this should error rather than mismatch)

To avoid mismatches, ensure artifacts either:
- Return the same value on server and client (static values, deterministic derived values)
- Are only used in client-only components (guarded with `typeof window !== 'undefined'` or framework-specific client-only wrappers)

### Implementation notes

ArtifactJS uses `useSyncExternalStore` with the same snapshot function for both server and client rendering:

- **Pending artifacts:** Suspend (throw promise) on both server and client, showing Suspense fallback
- **Resolved artifacts:** Return the resolved value on both server and client
- **Rejected artifacts:** Throw the error on both server and client, propagating to Error Boundary

This ensures consistent hydration behavior: the server and client render identical initial states, avoiding hydration mismatches for artifacts in any status (pending, resolved, or rejected).

## Error handling

If an artifact's initializer throws or a fetch fails, the error propagates to the nearest React Error Boundary:

```jsx
import { ErrorBoundary } from '@/components/ErrorBoundary';

<ErrorBoundary>
    <Suspense fallback={<div>Loading...</div>}>
        <UserList />
    </Suspense>
</ErrorBoundary>
```

### Error recovery and status inspection

For more control over loading states and error handling, Artifact provides status inspection APIs that let you handle errors inline without Error Boundaries:

#### `getArtifactStatus(ref)` — check status outside React

Returns `'pending'`, `'resolved'`, or `'rejected'`:

```jsx
import { getArtifactStatus, readArtifact, resetArtifact } from '@urlund/artifactjs';

const status = getArtifactStatus(usersArtifact);

if (status === 'pending') {
    console.log('Still loading...');
} else if (status === 'rejected') {
    console.log('Failed, retrying...');
    resetArtifact(usersArtifact);
} else {
    const users = readArtifact(usersArtifact);
    console.log('Users:', users);
}
```

**Important notes:**
- **Side effect:** Calling `getArtifactStatus()` triggers hydration (runs the initializer) if the artifact hasn't been accessed yet.
- **Revalidation:** When an artifact with `maxAge` expires and revalidates, this returns `'pending'` (not `'resolved'` with a stale value). The status transitions from `'resolved'` → `'pending'` → `'resolved'` during refresh. Use `readArtifact()` if you need to read the stale value while revalidation is in progress.

#### `useArtifactLoadable(ref)` — status-aware hook

Returns `{ status, value, error }` without suspending or throwing. Use this to build custom loading states, inline error messages, or retry UIs:

```jsx
import { useArtifactLoadable, useResetArtifact } from '@urlund/artifactjs';

function UserProfile({ userId }) {
    const loadable = useArtifactLoadable(userArtifact({ id: userId }));
    const reset = useResetArtifact(userArtifact({ id: userId }));

    if (loadable.status === 'pending') {
        return <Spinner />;
    }

    if (loadable.status === 'rejected') {
        const errorMessage = loadable.error instanceof Error 
            ? loadable.error.message 
            : String(loadable.error);
        return (
            <div>
                <p>Error: {errorMessage}</p>
                <button onClick={reset}>Retry</button>
            </div>
        );
    }

    return <div>Hello, {loadable.value.name}!</div>;
}
```

Unlike `useArtifactValue` (which suspends during loading and throws on error), `useArtifactLoadable` lets you handle all states explicitly in your component. This is useful when you want inline error messages or custom loading indicators without needing `<Suspense>` or `<ErrorBoundary>`.

**Loadable object:**

- `{ status: 'pending', value: undefined, error: undefined }` — initializer is running or revalidating
- `{ status: 'resolved', value: T, error: undefined }` — value is available and fresh
- `{ status: 'rejected', value: undefined, error: unknown }` — initializer threw an error

**Revalidation behavior:** When an artifact with `maxAge` expires and revalidates:
- The loadable status becomes `'pending'` with `value: undefined`
- There is **no stale-while-revalidate** behavior — the previous value is discarded
- This matches React Suspense semantics: the component shows `'pending'` state during refresh
- If you need to keep displaying the stale value during revalidation, use `readArtifact()` in your pending state (it returns the stale value during revalidation)

#### Retry recipe with `useResetArtifact` + Error Boundary

You can also combine `useResetArtifact` with an Error Boundary for a declarative retry pattern:

```jsx
import { ErrorBoundary } from 'react-error-boundary';
import { useResetArtifact } from '@urlund/artifactjs';

function ErrorFallback({ error, resetErrorBoundary }) {
    const resetUsers = useResetArtifact(usersArtifact);

    const handleRetry = () => {
        resetUsers();
        resetErrorBoundary();
    };

    return (
        <div>
            <p>Error: {error.message}</p>
            <button onClick={handleRetry}>Retry</button>
        </div>
    );
}

function App() {
    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<div>Loading...</div>}>
                <UserList />
            </Suspense>
        </ErrorBoundary>
    );
}
```

When the user clicks "Retry", `resetUsers()` re-fetches the data and `resetErrorBoundary()` clears the error state, allowing the component to re-render.

### Circular dependencies

Artifact detects circular dependencies in derived artifacts automatically. If artifact A depends on B, and B depends on A (directly or through a chain of dependencies), a clear error is thrown:

```jsx
const a = artifact(({ get }) => get(b) + 1);
const b = artifact(({ get }) => get(a) + 1);

readArtifact(a); // throws: "Circular dependency detected..."
```

This prevents infinite loops and stack overflows. Ensure your derived artifacts form a directed acyclic graph (DAG).

**SSR caveat:** Cycle detection uses a process-global computation stack. In concurrent SSR environments where multiple requests share the same process, this can lead to false cycle detection or stack pollution across requests (same concern as module-level state in SSR). Consider request isolation or per-request artifact instances if you encounter issues.

## Benchmarks

Compare Artifact against Jotai locally. The scenarios match the in-app benchmark (micro: vanilla store ops; React: hook updates with `requestAnimationFrame` timing, `memo` subscribers):

```bash
npm run benchmark
```

Or run suites separately:

```bash
npm run benchmark:micro   # create / read / write / subscribe / derived / reset (100k iters)
```

```bash
npm run benchmark:react   # 1000 subscribed React components (write + reset wall time)
```

Results print to the console. Absolute milliseconds vary by machine; React numbers in Node/jsdom are indicative — use a real browser for publishable render timings.

## API reference

| Export | Type | Description |
|---|---|---|
| `artifact(value, options?)` | function | Create an artifact with a static value, promise, or initializer function. Optional `maxAge` / `revalidate` control cache freshness |
| `artifactWithStorage(key, value?, opts?)` | function | Create an artifact persisted to `localStorage`/`sessionStorage` with cross-tab sync. Initial value is optional (defaults to `undefined`) |
| `useArtifact(ref)` | hook | Returns `[value, setValue, resetValue]` -- subscribes to changes. Suspends during revalidation |
| `useArtifactValue(ref)` | hook | Returns the current value — subscribes in this component, re-renders on change. Suspends during revalidation |
| `useSetArtifact(ref)` | hook | Returns a setter without subscribing in this component — subscribed components still re-render |
| `useResetArtifact(ref)` | hook | Returns a reset function -- restores initial value or re-fetches |
| `useArtifactLoadable(ref)` | hook | Returns `{ status, value, error }` without suspending or throwing — for custom loading/error UIs |
| `readArtifact(ref)` | function | Read the current value outside React (sync peek). Returns stale value during revalidation |
| `resolveArtifact(ref)` | function | Wait until resolved outside React; waits for fresh value during revalidation. Rejects on artifact error |
| `resetArtifact(ref)` | function | Reset to initial value outside React |
| `writeArtifact(ref, value)` | function | Write a value outside React |
| `subscribeArtifact(ref, fn)` | function | Subscribe to changes outside React, returns unsubscribe |
| `getArtifactStatus(ref)` | function | Get current status outside React: `'pending'`, `'resolved'`, or `'rejected'` |
