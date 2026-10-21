/** Opens the feedback dialog from anywhere (menus, footer) without loading the form code first. */
export const FEEDBACK_OPEN_EVENT = 'aisupport:feedback-open';
export function openFeedback(): void {
  window.dispatchEvent(new CustomEvent(FEEDBACK_OPEN_EVENT));
}
