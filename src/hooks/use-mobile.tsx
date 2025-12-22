import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function isRunningAsPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Add to Home Screen
    // @ts-ignore
    window.navigator.standalone === true
  );
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false);

  React.useEffect(() => {
    const update = () => {
      // ✅ If installed as app: treat it as NOT mobile (desktop layout)
      if (isRunningAsPWA()) {
        setIsMobile(false);
        return;
      }

      // Normal browser behavior
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    update();
    mql.addEventListener?.("change", update);
    window.addEventListener("resize", update);

    return () => {
      mql.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return isMobile;
}
