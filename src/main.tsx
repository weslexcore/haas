import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { createBrowserRuntime } from "./ui/bootstrap";
import { RuntimeProvider } from "./ui/runtime-context";
import "./ui/styles/global.css";

const runtime = await createBrowserRuntime();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RuntimeProvider runtime={runtime}>
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
