/**
 * Loader and types for Razorpay Checkout.
 *
 * Razorpay only ships a global script — there is no npm package that renders
 * the modal — so it is injected on demand rather than in index.html. Loading it
 * lazily keeps it off every page that isn't the pay page, and off the bundle
 * entirely for visitors who never check out.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string; backdrop_color?: string };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: any) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

// One in-flight promise for the whole app: two clicks must not inject two
// <script> tags, and a second call after the first resolves is free.
let loader: Promise<boolean> | null = null;

export const loadRazorpay = (): Promise<boolean> => {
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      // let a later attempt retry rather than caching the failure forever
      loader = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return loader;
};

export const openRazorpay = (options: RazorpayOptions) => {
  if (!window.Razorpay) throw new Error("Razorpay checkout is not loaded");
  const instance = new window.Razorpay(options);
  instance.open();
  return instance;
};
