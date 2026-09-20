import 'react-native';

declare module 'react-native' {
  // ItemT is unused here but must match React Native's own declaration for
  // the two interfaces to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface FlatListProps<ItemT> {
    /**
     * A real FlatList prop (Libraries/Lists/FlatList.js: "Enable an
     * optimization to memoize the item renderer to prevent unnecessary
     * rerenders") that's missing from React Native's TypeScript types.
     * Without it, FlatList wraps `renderItem` in a new function on every
     * render, so every visible cell re-renders whenever the list does.
     * Only helps if `renderItem` itself keeps its identity.
     */
    strictMode?: boolean;
  }
}
