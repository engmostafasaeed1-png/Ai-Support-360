export const OPEN_GLOBAL_SEARCH_EVENT = "global-search:open";
export const openGlobalSearch = () => window.dispatchEvent(new Event(OPEN_GLOBAL_SEARCH_EVENT));
