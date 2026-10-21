import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card p-8 text-center shadow-elevated sm:p-10">
        <div aria-hidden="true" className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Compass className="h-8 w-8" />
        </div>
        <h1 className="mb-2 text-display font-bold tracking-tight text-foreground">404</h1>
        <p className="mb-8 text-lg text-muted-foreground">Oops! Page not found</p>
        <a
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-card transition-colors duration-200 hover:bg-primary-shade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
