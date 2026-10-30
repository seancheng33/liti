interface LitiExamGuard {
  start: () => Promise<boolean>;
  stop: () => Promise<boolean>;
  onViolation: (cb: () => void) => void;
}

declare global {
  interface Window {
    liti?: { examGuard: LitiExamGuard };
  }
}

export {};
