import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "katex/dist/katex.min.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/screens-s0.css";
import "./styles/screens-s1.css";
import "./styles/screens-s2.css";
import "./styles/screens-s3.css";
import "./styles/screens-s4.css";
import "./styles/screens-s5.css";
import "./styles/screens-s6.css";
import "./styles/screens-s7.css";
import "./styles/screens-s8.css";
import "./styles/screens-s9.css";
import "./styles/screens-s10.css";
import "./styles/app.css";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
