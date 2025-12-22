import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function isRunningAsPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS
    // @ts-ignore
    window.navigator.standalone === true
  );
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const update = () => {
      const isPWA = isRunningAsPWA();

      // ✅ Desktop layout ONLY when installed AND wide enough
      if (isPWA && window.innerWidth >= 1024) {
        setIsMobile(false);
        return;
      }

      // ✅ Mobile layout on small screens
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    update();

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return isMobile;
}
