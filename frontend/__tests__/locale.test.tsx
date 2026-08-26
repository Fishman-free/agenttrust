import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageSwitch } from "@/app/components/language-switch";
import { DEFAULT_LOCALE, dictionaries, LOCALE_STORAGE_KEY, LocaleProvider, useLocale } from "@/lib/locale";

function Probe() {
  const { locale, dictionary } = useLocale();
  return <><output aria-label="locale">{locale}</output><span>{dictionary.home.title}</span><LanguageSwitch /></>;
}

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; });

describe("LocaleProvider", () => {
  it("uses English strictly by default without browser-language detection", () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "zh-CN" });
    render(<LocaleProvider><Probe /></LocaleProvider>);
    expect(screen.getByLabelText("locale")).toHaveTextContent(DEFAULT_LOCALE);
    expect(screen.getByText("Verifiable trust for AI agents")).toBeInTheDocument();
  });

  it("toggles, persists, and synchronizes the html lang", async () => {
    render(<LocaleProvider><Probe /></LocaleProvider>);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-CN" } });
    expect(screen.getByText("为智能体建立可验证的信任")).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe(dictionaries["zh-CN"].metadata.title);
  });

  it("restores a valid selection and ignores invalid storage", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    const first = render(<LocaleProvider><Probe /></LocaleProvider>);
    await waitFor(() => expect(screen.getByLabelText("locale")).toHaveTextContent("zh-CN"));
    first.unmount();
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    render(<LocaleProvider><Probe /></LocaleProvider>);
    expect(screen.getByLabelText("locale")).toHaveTextContent("en");
  });

  it("keeps dictionary key parity", () => {
    const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];
    expect(keys(dictionaries["zh-CN"]).sort()).toEqual(keys(dictionaries.en).sort());
  });
});
