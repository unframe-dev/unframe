import { useState } from "react";
import { apiClient } from "./api";
import { addSlide, createInitialEditorState } from "./editor";
import "./styles.css";

export function App() {
  const [state, setState] = useState(createInitialEditorState);

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <p className="eyebrow">Unframe / Web editor</p>
        <h1>Presentation workspace</h1>
        <p className="status">API: {apiClient ? "connected" : "unavailable"}</p>
      </header>
      <section className="editor-panel" aria-label="Presentation editor">
        <label>
          Title
          <input
            value={state.title}
            onChange={(event) => setState({ ...state, title: event.target.value })}
          />
        </label>
        <div className="slide-summary">
          <span>{state.slideCount} slide(s)</span>
          <button type="button" onClick={() => setState(addSlide)}>
            Add slide
          </button>
        </div>
      </section>
    </main>
  );
}
