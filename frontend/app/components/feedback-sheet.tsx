"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, MessageSquarePlus, X } from "lucide-react";
import { useLocale } from "@/lib/locale";

// 反馈类别（value 同时用于 GitHub issue 标题前缀）
const CATEGORIES = [
  { value: "Bug", key: "catBug" },
  { value: "Suggestion", key: "catSuggestion" },
  { value: "Content", key: "catContent" },
  { value: "Other", key: "catOther" },
] as const;

const ISSUES_NEW_URL = "https://github.com/Fishman-free/multiagent/issues/new";

/**
 * 「问题反馈，共建社区」弹窗。
 * 零后端方案：收集内容后生成预填 GitHub Issue（作者可在 Issues 里第一时间看到），
 * 并提供「复制反馈内容」兜底（用户可粘到任意渠道）。
 * 动效遵循 Apple Design：临界阻尼进出、可 Esc / 点遮罩关闭、打开即聚焦、reduced-motion 退化。
 */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, dictionary: t } = useLocale();
  const f = t.feedback;
  const [category, setCategory] = useState<string>("Bug");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLButtonElement>(null);

  const categoryLabel = CATEGORIES.find((c) => c.value === category)?.key ?? "catOther";

  // 打开时聚焦第一个控件；Esc 关闭
  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const composedBody = [
    `## ${f.bodyHeading}`,
    `${f.bodyCategory}: ${t.feedback[CATEGORIES.find((c) => c.value === category)?.key as keyof typeof f] ?? category}`,
    "",
    `### ${f.detailLabel}`,
    body.trim() || "-",
    "",
    `### ${f.contactLabel}`,
    contact.trim() || "-",
    "",
    "---",
    `${locale === "zh-CN" ? "来自" : "Sent from"} agenttrust.site ${locale === "zh-CN" ? "反馈弹窗" : "feedback dialog"}`,
  ].join("\n");

  const issueUrl = `${ISSUES_NEW_URL}?title=${encodeURIComponent(`[${t.feedback[categoryLabel as keyof typeof f] ?? category}] ${locale === "zh-CN" ? "用户反馈" : "User feedback"}`)}&body=${encodeURIComponent(composedBody)}`;

  const copyFeedback = async () => {
    try {
      await navigator.clipboard.writeText(composedBody);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 剪贴板不可用（非安全上下文）时静默 */ }
  };

  return (
    <div className="feedback-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="feedback-sheet" role="dialog" aria-modal="true" aria-label={f.title} ref={dialogRef}>
        <button className="feedback-close" onClick={onClose} aria-label={f.close}><X size={18} /></button>
        <span className="feedback-eyebrow"><MessageSquarePlus size={15} aria-hidden="true" />{f.eyebrow}</span>
        <h2 className="feedback-title">{f.title}</h2>
        <p className="feedback-sub">{f.subtitle}</p>

        <fieldset className="feedback-fieldset">
          <legend className="feedback-label">{f.categoryLabel}</legend>
          <div className="feedback-cats" role="radiogroup" aria-label={f.categoryLabel}>
            {CATEGORIES.map(({ value, key }) => (
              <button
                key={value}
                ref={value === "Bug" ? firstFieldRef : undefined}
                type="button"
                role="radio"
                aria-checked={category === value}
                className={`feedback-cat${category === value ? " is-active" : ""}`}
                onClick={() => setCategory(value)}
              >{t.feedback[key as keyof typeof f] as string}</button>
            ))}
          </div>
        </fieldset>

        <label className="feedback-label" htmlFor="feedback-body">{f.detailLabel}</label>
        <textarea
          id="feedback-body"
          className="feedback-textarea"
          rows={4}
          placeholder={f.detailPlaceholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <label className="feedback-label" htmlFor="feedback-contact">{f.contactLabel}</label>
        <input
          id="feedback-contact"
          className="feedback-contact"
          placeholder={f.contactPlaceholder}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />

        <div className="feedback-actions">
          <a className="feedback-submit" href={issueUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            <ExternalLink size={17} aria-hidden="true" />{f.submit}
          </a>
          <button className="feedback-copy" type="button" onClick={copyFeedback}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? f.copied : f.copy}
          </button>
        </div>
        <p className="feedback-note">{f.note}</p>
      </div>
    </div>
  );
}
