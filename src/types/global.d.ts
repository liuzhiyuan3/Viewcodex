import type { ViewcodexApi } from './viewcodex';

declare global {
  interface Window {
    viewcodex?: ViewcodexApi;
  }
}

