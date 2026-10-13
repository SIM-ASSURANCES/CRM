import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  /** Affiche l'astérisque rouge et renseigne aria-required. */
  required?: boolean;
  error?: string;
  /** Élément placé à droite dans le champ (ex. bouton « afficher le mot de passe »). */
  adornment?: ReactNode;
};

export function Field({ label, required, error, adornment, className, ...input }: FieldProps) {
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
      <div className="relative">
        <input
          id={id}
          required={required}
          aria-required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink placeholder:text-muted",
            "focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30",
            error ? "border-danger" : "border-line",
            adornment && "pr-11",
            className,
          )}
          {...input}
        />
        {adornment && <div className="absolute inset-y-0 right-0 flex items-center pr-2">{adornment}</div>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
