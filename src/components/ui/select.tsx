import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Option = { value: string | number; label: string };

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & {
  label: string;
  required?: boolean;
  error?: string;
  options: readonly Option[];
  /** Ajoute une première option vide (valeur « »). */
  placeholder?: string;
};

export function SelectField({ label, required, error, options, placeholder, className, ...select }: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <select
        id={id}
        aria-required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink",
          "focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30",
          error ? "border-danger" : "border-line",
          className,
        )}
        {...select}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
