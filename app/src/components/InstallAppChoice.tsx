import { useEffect, useMemo, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as NavigatorWithStandalone).standalone);
}

function deviceInstructions(): { title: string; steps: string[] } {
  const ua = navigator.userAgent;
  const appleMobile = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (appleMobile) {
    return {
      title: "Add FamilyTree to your Home Screen",
      steps: [
        "Open this page in Safari.",
        "Tap the Share button.",
        "Choose Add to Home Screen, then tap Add.",
      ],
    };
  }

  if (/Macintosh|Mac OS X/.test(ua)) {
    return {
      title: "Install FamilyTree on your Mac",
      steps: [
        "In Chrome, open the menu beside the address bar.",
        "Choose Cast, save and share, then Install page as app.",
        "In Safari, choose File, then Add to Dock.",
      ],
    };
  }

  if (/Windows/.test(ua)) {
    return {
      title: "Install FamilyTree on Windows",
      steps: [
        "Open the browser menu.",
        "Choose Apps, then Install FamilyTree.",
        "Open FamilyTree from the Start menu or desktop shortcut.",
      ],
    };
  }

  return {
    title: "Install FamilyTree",
    steps: [
      "Open your browser menu.",
      "Choose Install app or Add to Home screen.",
      "Launch FamilyTree from its new app icon.",
    ],
  };
}

/** Optional PWA installer. Browser use remains unchanged until the user opts in. */
export function InstallAppChoice() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showHelp, setShowHelp] = useState(false);
  const instructions = useMemo(deviceInstructions, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const chooseInstall = async () => {
    if (!installPrompt) {
      setShowHelp(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  return (
    <>
      <button type="button" className="install-app-choice" onClick={() => void chooseInstall()}>
        <span aria-hidden="true">⇩</span>
        Install FamilyTree
      </button>

      {showHelp && (
        <div className="install-help-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}>
          <section
            className="install-help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="install-help-icon" aria-hidden="true">FT</div>
            <p className="install-help-kicker">OPTIONAL APP MODE</p>
            <h2 id="install-help-title">{instructions.title}</h2>
            <p>Installing removes the normal browser tabs and address bar. You can keep using this website normally if you prefer.</p>
            <ol>
              {instructions.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <button type="button" className="install-help-done" onClick={() => setShowHelp(false)}>
              Not now
            </button>
          </section>
        </div>
      )}
    </>
  );
}
