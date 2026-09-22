import type { ApiSurface } from '../../shared/types';

declare global {
  interface Window {
    closedport: ApiSurface;
  }
}

export {};
