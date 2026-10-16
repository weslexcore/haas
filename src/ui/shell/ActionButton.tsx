import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useAvailable, useDispatch, useShortcut } from "../hooks";
import { useRuntime } from "../runtime-context";

interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title"> {
  actionId: string;
  params?: unknown;
  /** Accessible label; defaults to the action's label for these params, or its title. */
  label?: string;
  children: ReactNode;
}

/** A button that only dispatches an action: availability, tooltip and shortcut come from the registry. */
export function ActionButton({ actionId, params, label, children, ...rest }: ActionButtonProps) {
  const runtime = useRuntime();
  const available = useAvailable(actionId);
  const shortcut = useShortcut(actionId, params);
  const dispatch = useDispatch("ui");
  const action = runtime.registry.get(actionId);
  const name = label ?? action?.label?.(params) ?? action?.title ?? actionId;

  return (
    <button
      type="button"
      {...rest}
      disabled={!available || rest.disabled}
      aria-label={name}
      title={shortcut ? `${name} (${shortcut.strokes.join(" ")})` : name}
      onClick={() => void dispatch(actionId, params)}
    >
      {children}
    </button>
  );
}
