const MIN_SPEED = 0;
const MAX_SPEED = 64;
const MAX_NATIVE_SPEED = 16;
const CONTROLLER_KEY = "__SAYEED_SPEED_X_V32__";

async function executeController(tabId, command, value) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: (command, value) => {
        const KEY = "__SAYEED_SPEED_X_V32__";
        const MIN_SPEED = 0;
        const MAX_SPEED = 64;
        const MAX_NATIVE_SPEED = 16;

        const clamp = (n) => {
          const v = Number(n);
          return Number.isFinite(v)
            ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, v))
            : 1;
        };

        if (!window[KEY]) {
          const state = {
            requested: 1,
            enabled: true,
            attached: new WeakSet(),
            turboClock: new WeakMap()
          };

          // Find normal <video> elements and videos living inside open shadow roots.
          const videos = (root = document) => {
            const found = [];
            const seen = new Set();

            const walk = (node) => {
              if (!node || typeof node.querySelectorAll !== "function") return;

              for (const video of node.querySelectorAll("video")) {
                if (!seen.has(video)) {
                  seen.add(video);
                  found.push(video);
                }
              }

              for (const element of node.querySelectorAll("*")) {
                if (element.shadowRoot) walk(element.shadowRoot);
              }
            };

            walk(root);
            return found;
          };

          const getNativeSpeed = () =>
            Math.min(clamp(state.requested), MAX_NATIVE_SPEED);

          const apply = (video) => {
            if (!state.enabled || !video) return;

            const wanted = clamp(state.requested);
            const nativeSpeed = Math.min(wanted, MAX_NATIVE_SPEED);

            // For <=16x, use normal HTMLMediaElement playback.
            // For >16x, keep the native rate at 16x and let the turbo
            // clock advance currentTime by the remaining amount.
            try {
              if (Math.abs(Number(video.playbackRate) - nativeSpeed) > 0.001) {
                video.playbackRate = nativeSpeed;
              }
            } catch (_) {}

            try {
              if (Math.abs(Number(video.defaultPlaybackRate) - nativeSpeed) > 0.001) {
                video.defaultPlaybackRate = nativeSpeed;
              }
            } catch (_) {}

            try {
              video.dataset.sayeedVideoSpeed = String(wanted);
              video.dataset.sayeedVideoMode =
                wanted > MAX_NATIVE_SPEED ? "turbo" : "native";
            } catch (_) {}
          };

          const attach = (video) => {
            if (state.attached.has(video)) return;
            state.attached.add(video);

            const reapply = () => {
              if (state.enabled) apply(video);
            };

            [
              "loadedmetadata",
              "loadeddata",
              "canplay",
              "durationchange",
              "play",
              "playing"
            ].forEach((eventName) => {
              video.addEventListener(eventName, reapply, { passive: true });
            });

            video.addEventListener("ratechange", () => {
              if (!state.enabled) return;

              const nativeSpeed = getNativeSpeed();
              if (Math.abs(Number(video.playbackRate) - nativeSpeed) > 0.001) {
                apply(video);
              }
            }, { passive: true });
          };

          const scan = () => {
            const list = videos();
            list.forEach(attach);
            list.forEach(apply);
          };

          if (document.documentElement) {
            new MutationObserver(scan).observe(document.documentElement, {
              childList: true,
              subtree: true
            });
          }

          // Keep finding/re-applying on SPA navigation and recreated players.
          setInterval(scan, 250);

          // Ultra-style high-speed engine:
          // native 16x + extra timeline advancement = requested effective speed.
          setInterval(() => {
            const now = performance.now();
            const wanted = clamp(state.requested);

            for (const video of videos()) {
              const previous = state.turboClock.get(video) ?? now;
              state.turboClock.set(video, now);

              if (
                !state.enabled ||
                wanted <= MAX_NATIVE_SPEED ||
                video.paused ||
                video.seeking ||
                video.ended
              ) {
                continue;
              }

              const elapsedSeconds = Math.min(
                Math.max(0, (now - previous) / 1000),
                0.5
              );

              if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
                continue;
              }

              // Example at 64x:
              // 16x native + (64 - 16)x timeline advancement = ~64x effective.
              const extraSeconds =
                elapsedSeconds * (wanted - MAX_NATIVE_SPEED);

              const currentTime = Number(video.currentTime);
              if (!Number.isFinite(currentTime)) continue;

              const duration = Number(video.duration);
              const rawTarget = currentTime + extraSeconds;
              const targetTime = Number.isFinite(duration)
                ? Math.min(duration, rawTarget)
                : rawTarget;

              if (
                Number.isFinite(targetTime) &&
                targetTime > currentTime
              ) {
                try {
                  video.currentTime = targetTime;
                } catch (_) {}
              }
            }
          }, 250);

          window[KEY] = { state, scan };
        }

        const controller = window[KEY];
        const state = controller.state;

        if (command === "setSpeed") {
          state.requested = clamp(value);
        } else if (command === "changeSpeed") {
          state.requested = clamp(state.requested + Number(value || 0));
        } else if (command === "toggle") {
          state.enabled = Boolean(value);
        }

        controller.scan();

        return {
          ok: true,
          requestedSpeed: state.requested,
          enabled: state.enabled
        };
      },
      args: [command, value]
    });

    const good = results.find((entry) => entry?.result?.ok);
    return good?.result || { ok: false, error: "No controller result." };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function applyStoredState(tabId) {
  const settings = await chrome.storage.local.get({
    speed: 1,
    enabled: true
  });

  await executeController(tabId, "setSpeed", settings.speed);
  await executeController(tabId, "toggle", settings.enabled);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "pageReady") {
    (async () => {
      // Only the top frame needs to trigger the all-frames controller injection.
      if (sender.tab?.id && (sender.frameId ?? 0) === 0) {
        await applyStoredState(sender.tab.id);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.action !== "controller") return;

  (async () => {
    const tab = sender.tab ||
      (await chrome.tabs.query({
        active: true,
        currentWindow: true
      }))[0];

    if (!tab?.id) {
      sendResponse({ ok: false, error: "No active tab." });
      return;
    }

    const result = await executeController(
      tab.id,
      message.command,
      message.value
    );

    if (result.ok) {
      await chrome.storage.local.set({
        speed: result.requestedSpeed,
        enabled: result.enabled
      });
    }

    sendResponse(result);
  })();

  return true;
});

// Re-apply saved speed after a normal top-level navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    applyStoredState(tabId).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) return;

  let action = null;
  let value = null;

  if (command === "increase-speed") {
    action = "changeSpeed";
    value = 0.5;
  } else if (command === "decrease-speed") {
    action = "changeSpeed";
    value = -0.5;
  } else if (command === "reset-speed") {
    action = "setSpeed";
    value = 1;
  }

  if (action) {
    const result = await executeController(tab.id, action, value);

    if (result.ok) {
      await chrome.storage.local.set({
        speed: result.requestedSpeed,
        enabled: result.enabled
      });
    }
  }
});
