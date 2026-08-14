import { StackIcon } from "@phosphor-icons/react";
import { useEditorDocument } from "../document/editor-document-context";
import { useEditorSession } from "../session/editor-session-context";
export function SlideNavigator() {
  const { document } = useEditorDocument().history;
  const active = useEditorSession((s) => s.activeSlideId);
  const selected = useEditorSession((s) => s.selectedElementId);
  const setActive = useEditorSession((s) => s.setActiveSlide);
  const select = useEditorSession((s) => s.selectElement);
  return (
    <nav aria-label="スライドと要素">
      <div className="flex items-center gap-2 border-b px-4 py-4 text-xs font-semibold tracking-[.08em]">
        <StackIcon className="text-[#7187f5]" />
        スライド / SCENES
      </div>
      {document.slides.map((slide, index) => (
        <div key={slide.id}>
          <button
            type="button"
            onClick={() => setActive(slide.id)}
            className={`block w-full border-l-3 px-4 py-3 text-left hover:bg-[var(--accent)] ${slide.id === active ? "border-l-[#9a80d0] bg-[#9a80d01c]" : "border-l-transparent"}`}
          >
            <strong className="text-sm">
              {String(index + 1).padStart(2, "0")} {slide.name}
            </strong>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {slide.elements.length} elements
            </span>
          </button>
          {slide.id === active &&
            slide.elements.map((element) => (
              <button
                type="button"
                key={element.id}
                aria-label={`${element.name}を選択`}
                onClick={() => select(element.id)}
                className={`block min-h-10 w-full border-l-3 py-2 pl-8 text-left text-sm hover:bg-[var(--accent)] ${selected === element.id ? "border-l-[#7187f5] bg-[#7187f51a]" : "border-l-transparent"}`}
              >
                {element.name}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}
