import { describe, expect, it } from "vitest";
import { resolveEditModeShortcut } from "../annotations";

describe("resolveEditModeShortcut", () => {
  it("maps keys 1-6 to annotation kinds when focus is outside inputs", () => {
    const base = {
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      targetTagName: "BODY",
      isContentEditable: false,
    };
    expect(resolveEditModeShortcut({ ...base, key: "1" }, "note", false)).toEqual({
      type: "kind",
      kind: "linear",
    });
    expect(resolveEditModeShortcut({ ...base, key: "2" }, "linear", false)).toEqual({
      type: "kind",
      kind: "gdt",
    });
    expect(resolveEditModeShortcut({ ...base, key: "3" }, "linear", false)).toEqual({
      type: "kind",
      kind: "non_dimensional",
    });
    expect(resolveEditModeShortcut({ ...base, key: "4" }, "linear", false)).toEqual({
      type: "kind",
      kind: "note",
    });
    expect(resolveEditModeShortcut({ ...base, key: "5" }, "linear", false)).toEqual({
      type: "kind",
      kind: "point",
    });
    expect(resolveEditModeShortcut({ ...base, key: "6" }, "linear", false)).toEqual({
      type: "kind",
      kind: "datum",
    });
  });

  it("maps G to auto-recognize for non-point annotations with a marker", () => {
    const base = {
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      targetTagName: "DIV",
      isContentEditable: false,
    };
    expect(resolveEditModeShortcut({ ...base, key: "g" }, "linear", true)).toEqual({
      type: "recognize",
    });
    expect(resolveEditModeShortcut({ ...base, key: "G" }, "gdt", true)).toEqual({
      type: "recognize",
    });
    expect(resolveEditModeShortcut({ ...base, key: "g" }, "linear", false)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, key: "g" }, "point", true)).toEqual({
      type: "recognize",
    });
    expect(resolveEditModeShortcut({ ...base, key: "g" }, "point", false)).toBeNull();
  });

  it("maps Tab to focusFirstInput when outside inputs, and ignores Tab inside inputs", () => {
    const base = {
      key: "Tab",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      targetTagName: "BODY",
      isContentEditable: false,
    };
    expect(resolveEditModeShortcut(base, "linear", false)).toEqual({
      type: "focusFirstInput",
    });
    expect(resolveEditModeShortcut({ ...base, shiftKey: true }, "linear", false)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, targetTagName: "INPUT" }, "linear", false)).toBeNull();
  });

  it("ignores shortcuts inside form inputs, IME composition, or with modifiers", () => {
    const base = {
      key: "1",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      targetTagName: "BODY",
      isContentEditable: false,
    };
    expect(resolveEditModeShortcut({ ...base, targetTagName: "INPUT" }, "linear", true)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, targetTagName: "TEXTAREA", key: "g" }, "linear", true)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, isContentEditable: true }, "linear", true)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, isComposing: true }, "linear", true)).toBeNull();
    expect(resolveEditModeShortcut({ ...base, metaKey: true }, "linear", true)).toBeNull();
  });
});
