export const switcher = $state<{ activeIndex: number; switching: boolean }>({
  // No scene active yet; selectScene sets this to the loaded index after load,
  // so the button highlights only once its scene is actually live (and stays
  // unhighlighted if a load fails). -1 never equals a valid button index.
  activeIndex: -1,
  switching: false,
});
