# ArtifactJS

A lightweight shared-state library for React 19. Define data once, use it anywhere -- components that read the same artifact share one value and stay in sync automatically.

## Why?

React state (`useState`) lives inside a single component. If two components need the same data, you either lift state up or pass props down. Artifact removes that wiring: you define a piece of shared state **outside** your components, and any component can read or write it.

## Quick start

```jsx
import { artifact, useArtifact } from '@/hooks/artifact';

// 1. Define an artifact (outside any component)
const counterArtifact = artifact(0);

// 2. Use it in any component
function Counter() {
    const [count, setCount, resetValue] = useArtifact(counterArtifact);

    return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
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

### Persistent storage

Use `artifactWithStorage` to persist a value to `localStorage` (default) or `sessionStorage`. The stored value is read on creation, written on every update, and synced across browser tabs automatically:

```jsx
import { artifactWithStorage } from '@/hooks/artifact';

// Persists to localStorage by default
const themeArtifact = artifactWithStorage('theme', 'light');

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
import { readArtifact, writeArtifact, resetArtifact, subscribeArtifact } from '@/hooks/artifact';

// Read current value
const value = readArtifact(counterArtifact);

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

## API reference

| Export | Type | Description |
|---|---|---|
| `artifact(value)` | function | Create an artifact with a static value, promise, or initializer function |
| `artifactWithStorage(key, value, opts?)` | function | Create an artifact persisted to `localStorage`/`sessionStorage` with cross-tab sync |
| `useArtifact(ref)` | hook | Returns `[value, setValue, resetValue]` -- subscribes to changes |
| `useArtifactValue(ref)` | hook | Returns the current value — subscribes in this component, re-renders on change |
| `useSetArtifact(ref)` | hook | Returns a setter without subscribing in this component — subscribed components still re-render |
| `useResetArtifact(ref)` | hook | Returns a reset function -- restores initial value or re-fetches |
| `readArtifact(ref)` | function | Read the current value outside React |
| `resetArtifact(ref)` | function | Reset to initial value outside React |
| `writeArtifact(ref, value)` | function | Write a value outside React |
| `subscribeArtifact(ref, fn)` | function | Subscribe to changes outside React, returns unsubscribe |
