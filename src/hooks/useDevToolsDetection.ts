import { useEffect, useState } from 'react';

export function useDevToolsDetection(): boolean {
  // DevTools detection disabled — allowed for all users
  return false;
}
