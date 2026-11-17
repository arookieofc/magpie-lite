import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  mono?: boolean;
  invalid?: boolean;
}

// The one text field every form shares: .input chrome plus the
// mono/secret/invalid variants. Keeps the native element so refs,
// patterns, datalists and paste hooks all keep working untouched.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size, mono, invalid, className = "", ...rest },
  ref,
) {
  const cls = [
    "input",
    size === "sm" ? "sm" : "",
    mono ? "mono" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <input ref={ref} className={cls} aria-invalid={invalid || undefined} {...rest} />;
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  secret?: boolean;
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono, secret, invalid, className = "", ...rest },
  ref,
) {
  const cls = [
    "input",
    mono ? "mono" : "",
    secret ? "secret" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <textarea ref={ref} className={cls} aria-invalid={invalid || undefined} {...rest} />;
});
