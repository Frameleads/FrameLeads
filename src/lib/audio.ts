export type UISoundType = "send" | "notification" | "lock";

export const playUISound = (soundType: UISoundType) => {
  if (typeof window === "undefined") return;

  try {
    const audio = new Audio(`/sounds/${soundType}.mp3`);
    void audio.play().catch(() => undefined);
  } catch {
    // UI sounds are non-critical and may be blocked by browser autoplay policy.
  }
};
