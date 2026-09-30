// Back that always goes somewhere.
//
// A screen opened straight from a link (universal link, push tap) can be the
// only route in the stack, and then `navigation.goBack()` silently does
// nothing — the tester's "it opened the app but wouldn't let me go back".
// The linking config seeds `Main` underneath deep-linked screens, but this is
// the belt to that braces: if there is genuinely no history, reset to the
// home tabs (or Auth when signed out) instead of leaving the user stuck.

type NavLike = {
  canGoBack: () => boolean;
  goBack: () => void;
  reset: (state: { index: number; routes: { name: string }[] }) => void;
  getState?: () => { routeNames?: readonly string[] } | undefined;
};

export function goBackOrHome(navigation: NavLike): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  const routeNames = navigation.getState?.()?.routeNames ?? [];
  const home = routeNames.includes('Main') ? 'Main' : routeNames.includes('Auth') ? 'Auth' : 'Main';
  navigation.reset({ index: 0, routes: [{ name: home }] });
}
