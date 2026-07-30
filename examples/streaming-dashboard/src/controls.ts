/**
 * Binds #start and #stop buttons to the provided callbacks.
 */
export function setupStreamControls(onStart: () => void, onStop: () => void): void {
  const startBtn = document.getElementById("start");
  const stopBtn = document.getElementById("stop");

  if (startBtn) {
    startBtn.addEventListener("click", onStart);
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", onStop);
  }
}
