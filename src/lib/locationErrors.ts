import { toast } from 'sonner';

export const LOCATION_FIX_PATH = '/consultant/profile#profile-details';

/** The server refuses bids and invitation acceptance after the location grace period with a "country and city" message. */
export function isLocationBlockError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? '').toLowerCase();
  return msg.includes('country and city') || msg.includes('add your location');
}

/** Shows the error; a missing-location refusal gets an "Add my location" fix button. */
export function toastWithLocationFix(err: unknown, fallback: string, opts: { useMessage?: boolean } = {}): void {
  if (isLocationBlockError(err)) {
    toast.error((err as { message: string }).message, {
      action: { label: 'Add my location', onClick: () => { window.location.assign(LOCATION_FIX_PATH); } },
    });
    return;
  }
  toast.error(opts.useMessage === false ? fallback : (err as { message?: string } | null)?.message || fallback);
}
