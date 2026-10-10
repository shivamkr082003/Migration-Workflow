import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "../api/client";

/* ---------- Button ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-600/50",
  secondary: "bg-white text-zinc-800 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 shadow-sm disabled:text-zinc-400",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-600/50",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:text-zinc-300",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Badge ---------- */

type Tone = "zinc" | "green" | "red" | "amber" | "blue" | "brand" | "violet";
const tones: Record<Tone, string> = {
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "zinc", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export const statusTone = (s: string): Tone =>
  ({ approved: "green", succeeded: "green", matched: "green", accepted: "green", draft: "blue", running: "blue", superseded: "zinc", not_loaded: "zinc", rejected: "red", failed: "red", mismatched: "red", rolled_back: "violet", incomplete: "amber" })[s] as Tone ?? "zinc";

export const riskTone = (r: string): Tone => (r === "high" ? "red" : r === "medium" ? "amber" : "green");

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace("_", " ")}</Badge>;
}

/* ---------- Layout ---------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-xl bg-white shadow-sm ring-1 ring-zinc-200", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "green" | "red" | "amber" | "brand" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "brand" ? "text-brand-600" : "text-zinc-900";
  return (
    <Card className="px-4 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </Card>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-500 justify-center">
      <Loader2 className="size-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-zinc-400">{icon}</div>}
      <div className="text-sm font-medium text-zinc-900">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "success"; title?: ReactNode; children?: ReactNode }) {
  const map = {
    info: ["bg-sky-50 ring-sky-200 text-sky-900", <Info key="i" className="size-4 text-sky-600" />],
    warn: ["bg-amber-50 ring-amber-200 text-amber-900", <AlertTriangle key="w" className="size-4 text-amber-600" />],
    error: ["bg-red-50 ring-red-200 text-red-900", <XCircle key="e" className="size-4 text-red-600" />],
    success: ["bg-emerald-50 ring-emerald-200 text-emerald-900", <CheckCircle2 key="s" className="size-4 text-emerald-600" />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={clsx("flex gap-2.5 rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset", cls)}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={clsx(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <Callout tone="error" title={e ? e.message : "Something went wrong"}>
      {e && (
        <span className="font-mono text-xs">
          {e.code}
          {e.requestId && ` · request ${e.requestId.slice(0, 8)}`}
        </span>
      )}
      {e && Array.isArray(e.details) && e.details.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-xs">
          {(e.details as { message?: string; path?: string }[]).slice(0, 8).map((d, i) => (
            <li key={i}>{d.message ?? JSON.stringify(d)}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

/* ---------- Form controls ---------- */

export const inputCls =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-zinc-50";

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-zinc-700">
      {children}
      {hint && <span className="ml-1 font-normal text-zinc-400">{hint}</span>}
    </span>
  );
}

/* ---------- Dialog ---------- */

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx("m-auto w-[calc(100%-2rem)] rounded-xl bg-white p-0 shadow-2xl ring-1 ring-zinc-200 backdrop:bg-zinc-900/40 backdrop:backdrop-blur-[2px]", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: string;
}
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-zinc-200">
            <div className="flex items-start gap-2">
              {t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : t.tone === "error" ? <XCircle className="mt-0.5 size-4 text-red-600" /> : <Info className="mt-0.5 size-4 text-sky-600" />}
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-zinc-500 break-words">{t.body}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function errorToast(err: unknown): Omit<Toast, "id"> {
  if (err instanceof ApiError) return { tone: "error", title: err.message, body: err.code };
  return { tone: "error", title: "Something went wrong", body: String(err) };
}

/* ---------- Table helpers ---------- */

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx("px-3 py-2 align-top text-sm", className)}>
      {children}
    </td>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={clsx("rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-700", className)}>{children}</code>;
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}
