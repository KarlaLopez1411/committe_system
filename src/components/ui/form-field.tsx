'use client';

import { useId, useState } from 'react';

/**
 * Función de validación de un campo. Recibe el valor actual y devuelve un
 * mensaje de error legible, o `null`/`undefined` si el valor es válido.
 */
export type FieldValidator = (value: string) => string | null | undefined;

export interface FormFieldProps {
  /** Nombre del campo (se envía en el `FormData` de la Server Action). */
  name: string;
  /** Etiqueta visible del campo. */
  label: string;
  /** Tipo de input HTML (text, email, password, number, ...). */
  type?: string;
  /** Valor inicial no controlado. */
  defaultValue?: string;
  /** Placeholder opcional. */
  placeholder?: string;
  /** Marca el campo como obligatorio (atributo y semántica ARIA). */
  required?: boolean;
  /** Texto de ayuda mostrado debajo del campo cuando no hay error. */
  hint?: string;
  /** Atributo autoComplete para asistir a gestores de contraseñas/PWA. */
  autoComplete?: string;
  /** Deshabilita el campo (por ejemplo, durante el envío). */
  disabled?: boolean;
  /**
   * Validadores que se ejecutan de forma inmediata al cambiar/perder foco el
   * campo, antes de permitir el envío (Requirement 42.2). Se evalúan en orden
   * y se muestra el primer error encontrado.
   */
  validators?: FieldValidator[];
  /** Notifica al formulario contenedor si el campo es válido tras cada cambio. */
  onValidityChange?: (name: string, isValid: boolean) => void;
  /** Modo de input para teclados móviles optimizados (mobile-first). */
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

/**
 * Campo de formulario reutilizable con validación inmediata (Requirement 42.2).
 *
 * La validación se dispara en cada cambio y al perder el foco, mostrando el
 * primer mensaje de error debajo del campo y exponiéndolo vía `aria-invalid`
 * y `aria-describedby` para accesibilidad. Está diseñado mobile-first: alturas
 * de toque cómodas (`min-h-touch`) y tipografía legible en pantallas pequeñas
 * (Requirements 42.1, 43.1).
 */
export function FormField({
  name,
  label,
  type = 'text',
  defaultValue = '',
  placeholder,
  required = false,
  hint,
  autoComplete,
  disabled = false,
  validators = [],
  onValidityChange,
  inputMode,
}: FormFieldProps) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  function runValidation(current: string): string | null {
    if (required && current.trim().length === 0) {
      return 'Este campo es obligatorio.';
    }
    for (const validator of validators) {
      const message = validator(current);
      if (message) {
        return message;
      }
    }
    return null;
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    const message = runValidation(next);
    setError(message);
    onValidityChange?.(name, message === null);
  }

  function handleBlur() {
    setTouched(true);
    const message = runValidation(value);
    setError(message);
    onValidityChange?.(name, message === null);
  }

  const showError = touched && error !== null;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      <input
        id={fieldId}
        name={name}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errorId : hint ? hintId : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        className={[
          'min-h-touch w-full rounded-lg border px-3 py-2 text-base',
          'focus:outline-none focus:ring-2 focus:ring-brand',
          'disabled:cursor-not-allowed disabled:opacity-60',
          showError
            ? 'border-red-500 focus:ring-red-500'
            : 'border-gray-300 dark:border-gray-700',
          'bg-white dark:bg-gray-900',
        ].join(' ')}
      />
      {showError ? (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Validador reutilizable: formato de correo electrónico. */
export function emailValidator(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null; // La obligatoriedad la gestiona `required`.
  }
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return ok ? null : 'Ingresa un correo electrónico válido.';
}

/** Validador reutilizable: longitud mínima. */
export function minLengthValidator(min: number): FieldValidator {
  return (value: string) => {
    if (value.length === 0) {
      return null;
    }
    return value.length >= min
      ? null
      : `Debe tener al menos ${min} caracteres.`;
  };
}
