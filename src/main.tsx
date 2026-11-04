import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { readAuthMode } from "./adapters/auth/supabase-auth";
import { AuthGate } from "./ui/auth/AuthGate";
import "./ui/styles/global.css";

// The gate signs the user in, then creates the runtime and renders the app.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate mode={readAuthMode(import.meta.env)} />
  </StrictMode>,
);
